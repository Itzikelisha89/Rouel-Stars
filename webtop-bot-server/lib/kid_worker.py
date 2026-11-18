"""Run one child's webtop-bot as a sender only, through the shared Telegram bot.

The shared bot is polled by router.py, so this process never polls Telegram.
It checks WEBTOP only at CHECK_HOURS (default 8,10,12,14) Sunday-Friday, sends
new homework/messages/discipline, and puts the child's name on top of every
message. The 17:00/19:00 messages are off unless DAILY_SUMMARIES=true. Run from the child's folder:
  /opt/webtop-bot/venv/bin/python /opt/webtop-bot/lib/kid_worker.py
"""
import asyncio
import os
import signal
import sys

sys.path.insert(0, os.getcwd())

from dotenv import load_dotenv

load_dotenv(os.path.join(os.getcwd(), ".env"), override=True)  # the child's settings win over the computer's

import telegram
from telegram.ext import Application

LABEL = os.environ.get("KID_LABEL", "").strip() or os.path.basename(os.getcwd())
HEADER = f"🎒 {LABEL}\n"

base_url = os.environ.get("TELEGRAM_BASE_URL")  # only for local tests
if base_url:
    _init = telegram.Bot.__init__

    def _init_with_base(self, *args, **kwargs):
        kwargs["base_url"] = base_url
        _init(self, *args, **kwargs)

    telegram.Bot.__init__ = _init_with_base


def _wrap(method_name: str, field: str, position: int) -> None:
    original = getattr(telegram.Bot, method_name)

    async def wrapper(self, *args, **kwargs):
        kwargs.pop("reply_markup", None)  # no menu in the shared bot
        if field in kwargs:
            if kwargs[field]:
                kwargs[field] = HEADER + kwargs[field]
        elif len(args) > position and args[position]:
            args = list(args)
            args[position] = HEADER + args[position]
        elif field == "caption":
            kwargs[field] = HEADER.strip()
        return await original(self, *args, **kwargs)

    setattr(telegram.Bot, method_name, wrapper)


_wrap("send_message", "text", 1)
for _name in ("send_photo", "send_document", "send_video", "send_audio"):
    _wrap(_name, "caption", 2)


def _run_without_polling(self, *args, **kwargs):
    async def main():
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                loop.add_signal_handler(sig, stop.set)
            except (NotImplementedError, RuntimeError):
                pass  # Windows: the process is stopped by its supervisor instead
        await self.initialize()
        if self.post_init:
            import webtop_service

            real_dashboard = webtop_service.webtop.get_raw_dashboard

            async def _skip_startup_login(*_a, **_k):
                return None

            webtop_service.webtop.get_raw_dashboard = _skip_startup_login  # no sign-in on start
            try:
                await self.post_init(self)
            finally:
                webtop_service.webtop.get_raw_dashboard = real_dashboard
        await self.start()
        print(f"{LABEL}: running, sending alerts only", flush=True)
        await stop.wait()
        await self.stop()
        if self.post_shutdown:
            await self.post_shutdown(self)
        await self.shutdown()

    asyncio.run(main())


Application.run_polling = _run_without_polling

# Be gentle with WEBTOP (agreed with the Ministry of Education): check only at
# fixed hours on school days, children 5 minutes apart, and nothing else.
import datetime as _dt  # noqa: E402
from zoneinfo import ZoneInfo  # noqa: E402

from telegram.ext import JobQueue  # noqa: E402

CHECK_HOURS = [int(h) for h in (os.environ.get("CHECK_HOURS") or "8,10,12,14").split(",") if h.strip()]
SCHOOL_DAYS = (0, 1, 2, 3, 4, 5)  # PTB counts 0 = Sunday ... 6 = Saturday
try:
    _index = max(0, int(os.environ.get("SIGNATURE_PORT") or 8765) - 8765)
except ValueError:
    _index = 0
_run_repeating = JobQueue.run_repeating
_run_daily = JobQueue.run_daily


def _fixed_hours_instead(self, callback, interval, *args, **kwargs):
    if getattr(callback, "__name__", "") != "check_notifications":
        return _run_repeating(self, callback, interval, *args, **kwargs)
    zone = ZoneInfo("Asia/Jerusalem")
    job = None
    for hour in CHECK_HOURS:
        at = _dt.time(hour=hour, minute=(_index * 5) % 60, tzinfo=zone)
        job = _run_daily(self, callback, time=at, days=SCHOOL_DAYS, name=f"check_notifications_{hour:02d}")
    return job


def _only_wanted_daily(self, callback, *args, **kwargs):
    if getattr(callback, "__name__", "") in ("send_daily_summary", "send_evening_schedule") \
            and os.environ.get("DAILY_SUMMARIES", "").lower() not in ("1", "true", "yes"):
        return None  # off: these also sign in to WEBTOP
    return _run_daily(self, callback, *args, **kwargs)


JobQueue.run_repeating = _fixed_hours_instead
JobQueue.run_daily = _only_wanted_daily

if __name__ == "__main__":
    import bot  # noqa: E402  (webtop-bot's bot.py in the current folder)

    bot.main()
