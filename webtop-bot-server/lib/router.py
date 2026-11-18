"""The only process that reads messages sent to the shared Telegram bot.

- Anyone: gets their chat ID (needed to allow them).
- Allowed chats can ask in plain Hebrew ("מה היה היום?", "שיעורי בית של נועה",
  "מה יש מחר?") or press the buttons. The bot signs in to WEBTOP and answers
  only the chat that asked, one child at a time, at most once every
  SUMMARY_COOLDOWN_MINUTES (default 30) per child and question.
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
load_dotenv(BASE / "shared.env", override=True)  # never another bot's token

SUMMARY_BUTTON = "📋 סיכום היום"
TOMORROW_BUTTON = "🗓️ מה יש מחר"
TOMORROW_WORDS = ("מחר", "מערכת", "תיק")
TODAY_WORDS = ("היום", "סיכום", "שיעורי", "שעורי", "מה היה", "בדוק", "בדיקה", "/summary")
COOLDOWN = int(os.environ.get("SUMMARY_COOLDOWN_MINUTES") or 30) * 60
GAP = int(os.environ.get("SUMMARY_GAP_SECONDS") or 60)
KEYBOARD = ReplyKeyboardMarkup([[KeyboardButton(SUMMARY_BUTTON), KeyboardButton(TOMORROW_BUTTON)]],
                               resize_keyboard=True)
SEND_SUMMARY = Path(__file__).with_name("send_summary.py")
NOT_ALLOWED = "המספר שלך: {}\nכדי לקבל עדכונים, צריך להוסיף אותו בשרת."

_state = {"running": False, "last": {}}  # last[(kid folder, mode)] = time


def allowed_ids() -> set[int]:
    import re

    raw = dotenv_values(BASE / "shared.env").get("ALLOWED_CHAT_IDS") or ""
    return {int(n) for n in re.findall(r"-?\d+", raw) if not n.startswith("-")}  # ignores hidden marks/spaces


def kid_dirs() -> list[Path]:
    return [env.parent for env in sorted((BASE / "kids").glob("*/.env"))]


def label_of(folder: Path) -> str:
    return dotenv_values(folder / ".env").get("KID_LABEL") or folder.name


def kid_names() -> list[str]:
    return [label_of(d) for d in kid_dirs()]


def understand(text: str):
    """Return (mode, kid folders) or (None, []) when the question is not understood."""
    mode = None
    if text == TOMORROW_BUTTON or any(w in text for w in TOMORROW_WORDS):
        mode = "tomorrow"
    elif text == SUMMARY_BUTTON or any(w in text for w in TODAY_WORDS):
        mode = "today"
    folders = kid_dirs()
    named = [d for d in folders if label_of(d) and label_of(d) in text]
    return mode, (named or folders)


async def run_answers(bot, chat_id: int, mode: str, folders: list[Path]) -> None:
    try:
        results = []
        for i, folder in enumerate(folders):
            if i:
                await asyncio.sleep(GAP)
            proc = await asyncio.create_subprocess_exec(
                sys.executable, str(SEND_SUMMARY), mode, cwd=folder,
                env={**os.environ, "TZ": "Asia/Jerusalem", "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8",
                     "ANSWER_CHAT_ID": str(chat_id)},  # answer only the chat that asked
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                **({"creationflags": 0x08000000} if os.name == "nt" else {}),  # no console window on Windows
            )
            try:
                out, _ = await asyncio.wait_for(proc.communicate(), timeout=300)
            except asyncio.TimeoutError:
                proc.kill()
                out = b""
            ok = proc.returncode == 0
            results.append(f"{'✅' if ok else '⚠️ לא הצלחתי להיכנס לאתר עבור'} {label_of(folder)}")
            last = out.decode(errors="replace").strip().splitlines()[-1:]
            print(last[0] if last else f"{label_of(folder)}: no output", flush=True)
        if len(folders) > 1 or not all(r.startswith("✅") for r in results):
            await bot.send_message(chat_id, "סיימתי:\n" + "\n".join(results), reply_markup=KEYBOARD)
    finally:
        _state["running"] = False


async def handle(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat = update.effective_chat
    if chat is None:
        return
    if chat.id not in allowed_ids():
        await context.bot.send_message(chat.id, NOT_ALLOWED.format(chat.id))
        return
    text = (update.effective_message.text or "").strip() if update.effective_message else ""
    mode, folders = understand(text)
    if mode is None:
        names = ", ".join(kid_names()) or "עדיין אין ילדים"
        await context.bot.send_message(chat.id, (
            "✅ הבוט פעיל ושולח עדכונים על: " + names + "\n\n"
            "• בדיקה אוטומטית ב-8:00, 10:00, 12:00 ו-14:00, ימים א'–ו'\n"
            "• אפשר לשאול למשל:\n"
            "  \"מה היה היום?\"  \"שיעורי בית של " + (kid_names() or ["נועה"])[0] + "\"\n"
            "  \"מה יש מחר?\"  \"מערכת למחר\"\n"
            "• או ללחוץ על הכפתורים למטה"), reply_markup=KEYBOARD)
        return
    if _state["running"]:
        await context.bot.send_message(chat.id, "⏳ אני עוד בודק את השאלה הקודמת, רגע...")
        return
    now = time.time()
    ready = [d for d in folders if now - _state["last"].get((str(d), mode), 0) >= COOLDOWN]
    waiting = [d for d in folders if d not in ready]
    if waiting:
        mins = max(int((COOLDOWN - (now - _state["last"][(str(d), mode)])) // 60) + 1 for d in waiting)
        await context.bot.send_message(chat.id, (
            "כדי לא להעמיס על האתר, כבר בדקתי לאחרונה עבור " + ", ".join(label_of(d) for d in waiting)
            + f". אפשר לשאול שוב בעוד {mins} דקות."), reply_markup=KEYBOARD)
    if not ready:
        return
    for d in ready:
        _state["last"][(str(d), mode)] = now
    _state["running"] = True
    what = "מה יש מחר" if mode == "tomorrow" else "מה היה היום"
    eta = "" if len(ready) == 1 else f" זה ייקח כ-{(len(ready) - 1) * GAP // 60 + 1} דקות."
    await context.bot.send_message(chat.id, f"🔄 בודק {what} עבור {', '.join(label_of(d) for d in ready)}...{eta}")
    context.application.create_task(run_answers(context.bot, chat.id, mode, ready))


def main() -> None:
    builder = Application.builder().token(os.environ["TELEGRAM_TOKEN"])
    if os.environ.get("TELEGRAM_BASE_URL"):  # only for local tests
        builder = builder.base_url(os.environ["TELEGRAM_BASE_URL"])
    app = builder.build()
    app.add_handler(MessageHandler(filters.ALL, handle))
    app.run_polling(drop_pending_updates=True, bootstrap_retries=-1)


if __name__ == "__main__":
    main()
