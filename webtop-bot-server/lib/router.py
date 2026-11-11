"""The only process that reads messages sent to the shared Telegram bot.

It answers anyone with their chat ID (needed to allow them), and tells allowed
chats which children the bot reports on. The children's processes send the
actual alerts.
"""
import os
from pathlib import Path

from dotenv import dotenv_values, load_dotenv
from telegram import Update
from telegram.ext import Application, ContextTypes, MessageHandler, filters

BASE = Path(os.environ.get("WEBTOP_BASE", "/opt/webtop-bot"))
load_dotenv(BASE / "shared.env")


def allowed_ids() -> set[int]:
    raw = dotenv_values(BASE / "shared.env").get("ALLOWED_CHAT_IDS") or ""
    return {int(x) for x in raw.split(",") if x.strip().isdigit()}


def kid_names() -> list[str]:
    names = []
    for env in sorted((BASE / "kids").glob("*/.env")):
        names.append(dotenv_values(env).get("KID_LABEL") or env.parent.name)
    return names


async def reply(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat = update.effective_chat
    if chat is None:
        return
    if chat.id in allowed_ids():
        names = ", ".join(kid_names()) or "עדיין אין ילדים"
        text = (
            "✅ הבוט פעיל ושולח עדכונים אוטומטיים על: " + names + "\n\n"
            "• שיעורי בית, הודעות ומשמעת חדשים – תוך כ-10 דקות\n"
            "• 17:00 – סיכום יומי\n"
            "• 19:00 – מערכת שעות למחר"
        )
    else:
        text = f"המספר שלך: {chat.id}\nכדי לקבל עדכונים, צריך להוסיף אותו בשרת."
    await context.bot.send_message(chat.id, text)


def main() -> None:
    builder = Application.builder().token(os.environ["TELEGRAM_TOKEN"])
    if os.environ.get("TELEGRAM_BASE_URL"):  # only for local tests
        builder = builder.base_url(os.environ["TELEGRAM_BASE_URL"])
    app = builder.build()
    app.add_handler(MessageHandler(filters.ALL, reply))
    app.run_polling(drop_pending_updates=True, bootstrap_retries=-1)


if __name__ == "__main__":
    main()
