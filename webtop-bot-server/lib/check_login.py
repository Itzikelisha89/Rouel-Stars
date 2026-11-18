"""Try one WEBTOP sign-in for the child whose folder this runs in, and explain the result.

Run from the child's folder (the  webtop-check  command does this):
  /opt/webtop-bot/venv/bin/python /opt/webtop-bot/lib/check_login.py
Prints no password or token. Exit code 0 means the sign-in worked.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.getcwd())

from dotenv import load_dotenv

load_dotenv(os.path.join(os.getcwd(), ".env"), override=True)


def clean_allowed_chat_ids() -> None:
    """Keep only plain chat ID numbers (copied text can hide marks, quotes or spaces)."""
    import re
    import unicodedata

    raw = os.environ.get("ALLOWED_CHAT_IDS", "")
    numbers = re.findall(r"-?\d+", raw)
    clean = ",".join(n for n in numbers if not n.startswith("-"))
    if clean == raw:
        return
    odd = sorted({unicodedata.name(c, hex(ord(c))) for c in raw if not c.isdigit() and c not in ",-"})
    groups = sum(n.startswith("-") for n in numbers)
    print(f"note: ALLOWED_CHAT_IDS cleaned - kept {len(numbers) - groups} chat ID(s)"
          + (f", removed characters: {', '.join(odd)}" if odd else "")
          + (f", dropped {groups} group ID(s) (negative numbers are not supported)" if groups else ""), flush=True)
    if not clean:
        print("WARNING: no usable chat ID left - run allow-chat with the parent's chat ID", flush=True)
    os.environ["ALLOWED_CHAT_IDS"] = clean


clean_allowed_chat_ids()

import httpx


def explain_http(status: int, body: str) -> str:
    text = body.lower()
    if status == 403 and ("cloudfront" in text or "request blocked" in text):
        return ("BLOCKED: the WEBTOP website refuses requests from this server's address "
                "(CloudFront 403). The username and password were not even checked.")
    if status in (401, 403):
        return f"REJECTED: WEBTOP answered HTTP {status}. Usually a wrong username or password."
    if status == 429:
        return "TOO MANY ATTEMPTS: WEBTOP is rate limiting. Wait 30 minutes and try once."
    return f"HTTP {status} from WEBTOP: {body[:300]!r}"


async def main() -> int:
    from webtop_service import WebtopService

    label = os.environ.get("KID_LABEL") or os.path.basename(os.getcwd())
    user = os.environ.get("WEBTOP_USERNAME", "")
    print(f"Child: {label}   username: {user[:2]}{'*' * max(0, len(user) - 2)}")
    service = WebtopService()
    client = await service._build_client()
    captured = {}
    original_post = client._http.post

    async def recording_post(*args, **kwargs):
        response = await original_post(*args, **kwargs)
        captured["response"] = response
        return response

    client._http.post = recording_post
    try:
        session = await client.login()
        name = f"{session.first_name or ''} {session.last_name or ''}".strip()
        print(f"OK: signed in as {name or '(no name returned)'}, school: {session.school_name or '?'}")
        return 0
    except httpx.HTTPStatusError as exc:
        print(explain_http(exc.response.status_code, exc.response.text))
    except httpx.HTTPError as exc:
        print(f"NETWORK: could not reach WEBTOP ({type(exc).__name__}: {exc})")
    except Exception as exc:  # WebtopLoginError and friends carry a readable reason
        print(f"REFUSED: {exc}")
        response = captured.get("response")
        if response is not None:
            try:
                body = response.json()
            except ValueError:
                body = None
            if isinstance(body, dict):
                said = {k: body.get(k) for k in ("status", "message", "errorDescription", "errorCode") if k in body}
                print(f"WEBTOP said: {said}")
    finally:
        await client.close()
    return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
