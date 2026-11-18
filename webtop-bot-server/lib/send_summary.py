"""Answer one question for the child whose folder this runs in. One WEBTOP sign-in.

  send_summary.py today      today's summary (homework etc.)
  send_summary.py tomorrow   tomorrow's schedule and what to pack
The answer goes to ALLOWED_CHAT_IDS from the environment (the router sets it
to the chat that asked).
"""
import asyncio
import os
import sys
from datetime import date
from types import SimpleNamespace

import kid_worker  # noqa: F401  (loads the child's .env, adds the name header)

if os.environ.get("ANSWER_CHAT_ID"):  # the router asks to answer only the chat that asked
    os.environ["ALLOWED_CHAT_IDS"] = os.environ["ANSWER_CHAT_ID"]


async def main(mode: str) -> int:
    import notifier
    from resilience import ResilientBot
    from webtop_service import webtop

    bot = ResilientBot(token=os.environ["TELEGRAM_TOKEN"])
    context = SimpleNamespace(bot=bot)
    try:
        async with bot:
            if mode == "tomorrow":
                if date.today().isoweekday() in (5, 6):  # Friday/Saturday: no school tomorrow
                    for chat in os.environ.get("ALLOWED_CHAT_IDS", "").split(","):
                        if chat.strip():
                            await bot.send_message(chat_id=int(chat), text="מחר אין לימודים 🙂")
                else:
                    await notifier.send_evening_schedule(context)
            else:
                if date.today().isoweekday() == 6:
                    for chat in os.environ.get("ALLOWED_CHAT_IDS", "").split(","):
                        if chat.strip():
                            await bot.send_message(chat_id=int(chat), text="היום שבת, אין סיכום 🙂")
                else:
                    await notifier.send_daily_summary(context)
        print(f"{kid_worker.LABEL}: {mode} sent")
        return 0
    except Exception as exc:
        print(f"{kid_worker.LABEL}: {mode} failed: {type(exc).__name__}: {exc}")
        return 1
    finally:
        await webtop.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main((sys.argv[1:] or ["today"])[0])))
