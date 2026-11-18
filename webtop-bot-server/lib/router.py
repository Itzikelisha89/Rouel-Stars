"""The only process that reads messages sent to the shared Telegram bot.

- Anyone: gets their chat ID (needed to allow them).
- Allowed chats: "📋 סיכום היום" (or "סיכום" / /summary) signs in to WEBTOP and
  sends today's summary for every child, one child at a time. At most once
  every SUMMARY_COOLDOWN_MINUTES (default 30), to keep WEBTOP traffic low.
The children's processes send the scheduled alerts.
"""
import asyncio
import os
import sys
import time
from pathlib import Path

from dotenv import dotenv_values, load_dotenv
from telegram import KeyboardButton, ReplyKeyboardMarkup, Update
from telegram.ext import Application, ContextTypes, MessageHandler, filters

BASE = Path(os.environ.get("WEBTOP_BASE", "/opt/webtop-bot"))
load_dotenv(BASE / "shared.env")

SUMMARY_BUTTON = "📋 סיכום היום"
SUMMARY_WORDS = {SUMMARY_BUTTON, "סיכום", "סיכום היום", "/summary", "בדוק", "בדיקה"}
COOLDOWN = int(os.environ.get("SUMMARY_COOLDOWN_MINUTES") or 30) * 60
GAP = int(os.environ.get("SUMMARY_GAP_SECONDS") or 60)
KEYBOARD = ReplyKeyboardMarkup([[KeyboardButton(SUMMARY_BUTTON)]], resize_keyboard=True)
SEND_SUMMARY = Path(__file__).with_name("send_summary.py")

_state = {"last": 0.0, "running": False}


def allowed_ids() -> set[int]:
    raw = dotenv_values(BASE / "shared.env").get("ALLOWED_CHAT_IDS") or ""
    return {int(x) for x in raw.split(",") if x.strip().isdigit()}


def kid_dirs() -> list[Path]:
    return [env.parent for env in sorted((BASE / "kids").glob("*/.env"))]


def kid_names() -> list[str]:
    return [dotenv_values(d / ".env").get("KID_LABEL") or d.name for d in kid_dirs()]


async def run_summaries(bot, chat_id: int) -> None:
    try:
        results = []
        for i, folder in enumerate(kid_dirs()):
            if i:
                await asyncio.sleep(GAP)
            proc = await asyncio.create_subprocess_exec(
                sys.executable, str(SEND_SUMMARY), cwd=folder,
                env={**os.environ, "TZ": "Asia/Jerusalem", "PYTHONUNBUFFERED": "1"},
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            )
            try:
                out, _ = await asyncio.wait_for(proc.communicate(), timeout=300)
            except asyncio.TimeoutError:
                proc.kill()
                out = b""
            label = dotenv_values(folder / ".env").get("KID_LABEL") or folder.name
            results.append(f"{'✅' if proc.returncode == 0 else '⚠️'} {label}")
            print(out.decode(errors="replace").strip().splitlines()[-1:] or [f"{label}: no output"], flush=True)
        await bot.send_message(chat_id, "סיימתי:\n" + "\n".join(results), reply_markup=KEYBOARD)
    finally:
        _state["running"] = False


async def summary(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat = update.effective_chat
    if chat.id not in allowed_ids():
        await context.bot.send_message(chat.id, f"המספר שלך: {chat.id}\nכדי לקבל עדכונים, צריך להוסיף אותו בשרת.")
        return
    if _state["running"]:
        await context.bot.send_message(chat.id, "⏳ כבר בודק, הסיכום בדרך.")
        return
    wait = _state["last"] + COOLDOWN - time.time()
    if wait > 0:
        await context.bot.send_message(
            chat.id, f"כדי לא להעמיס על האתר, אפשר לבקש סיכום שוב בעוד {int(wait // 60) + 1} דקות.",
            reply_markup=KEYBOARD)
        return
    _state.update(running=True, last=time.time())
    minutes = max(1, (len(kid_dirs()) - 1) * GAP // 60 + 1)
    await context.bot.send_message(chat.id, f"🔄 נכנס לאתר ובודק לכל ילד. זה ייקח כ-{minutes} דקות...")
    context.application.create_task(run_summaries(context.bot, chat.id))


async def reply(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat = update.effective_chat
    if chat is None:
        return
    if chat.id in allowed_ids():
        names = ", ".join(kid_names()) or "עדיין אין ילדים"
        text = (
            "✅ הבוט פעיל ושולח עדכונים אוטומטיים על: " + names + "\n\n"
            "• שיעורי בית, הודעות ומשמעת חדשים\n"
            "• בדיקה ב-8:00, 10:00, 12:00 ו-14:00, ימים א'–ו'\n"
            f"• לסיכום של היום עכשיו: לחצו \"{SUMMARY_BUTTON}\""
        )
        await context.bot.send_message(chat.id, text, reply_markup=KEYBOARD)
    else:
        await context.bot.send_message(chat.id, f"המספר שלך: {chat.id}\nכדי לקבל עדכונים, צריך להוסיף אותו בשרת.")


def main() -> None:
    builder = Application.builder().token(os.environ["TELEGRAM_TOKEN"])
    if os.environ.get("TELEGRAM_BASE_URL"):  # only for local tests
        builder = builder.base_url(os.environ["TELEGRAM_BASE_URL"])
    app = builder.build()
    app.add_handler(MessageHandler(filters.Text(list(SUMMARY_WORDS)) | filters.Command("summary"), summary))
    app.add_handler(MessageHandler(filters.ALL, reply))
    app.run_polling(drop_pending_updates=True, bootstrap_retries=-1)


if __name__ == "__main__":
    main()
