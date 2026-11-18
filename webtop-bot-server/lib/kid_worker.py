"""Run one child's webtop-bot as a sender only, through the shared Telegram bot.

The shared bot is polled by router.py, so this process never polls Telegram.
It keeps all of webtop-bot's scheduled jobs (new homework/messages/discipline
every 10 minutes, 17:00 summary, 19:00 tomorrow's schedule) and puts the
child's name on top of every message. Run from the child's folder:
  /opt/webtop-bot/venv/bin/python /opt/webtop-bot/lib/kid_worker.py
"""
import asyncio
import os
import signal
import sys

sys.path.insert(0, os.getcwd())

from dotenv import load_dotenv

load_dotenv(os.path.join(os.getcwd(), ".env"))

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
            loop.add_signal_handler(sig, stop.set)
        await self.initialize()
        if self.post_init:
            await self.post_init(self)
        await self.start()
        print(f"{LABEL}: running, sending alerts only", flush=True)
        await stop.wait()
        await self.stop()
        if self.post_shutdown:
            await self.post_shutdown(self)
        await self.shutdown()

    asyncio.run(main())


Application.run_polling = _run_without_polling

# Be gentle with WEBTOP: several children share one server address, so check
# less often than upstream (every 10 minutes) and spread the children apart.
from telegram.ext import JobQueue  # noqa: E402

POLL_SECONDS = int(os.environ.get("POLL_MINUTES") or 30) * 60
try:
    _index = max(0, int(os.environ.get("SIGNATURE_PORT") or 8765) - 8765)
except ValueError:
    _index = 0
_run_repeating = JobQueue.run_repeating


def _gentle_run_repeating(self, callback, interval, *args, **kwargs):
    if getattr(callback, "__name__", "") == "check_notifications":
        interval = POLL_SECONDS
        kwargs["first"] = 120 + _index * 300  # kid1 after 2 min, kid2 after 7, kid3 after 12
    return _run_repeating(self, callback, interval, *args, **kwargs)


JobQueue.run_repeating = _gentle_run_repeating

import bot  # noqa: E402  (webtop-bot's bot.py in the current folder)

bot.main()
