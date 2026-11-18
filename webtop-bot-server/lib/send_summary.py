"""Send today's school summary for the child whose folder this runs in, once.

Used by  webtop-summary  when the parent asks for it. One WEBTOP sign-in.
"""
import asyncio
import os
import sys
from types import SimpleNamespace

import kid_worker  # noqa: F401  (loads the child's .env, adds the name header)


async def main() -> int:
    import notifier
    from resilience import ResilientBot
    from webtop_service import webtop

    bot = ResilientBot(token=os.environ["TELEGRAM_TOKEN"])
    try:
        async with bot:
            await notifier.send_daily_summary(SimpleNamespace(bot=bot))
        print(f"{kid_worker.LABEL}: summary sent (none on Saturday or a vacation day)")
        return 0
    except Exception as exc:
        print(f"{kid_worker.LABEL}: summary failed: {type(exc).__name__}: {exc}")
        return 1
    finally:
        await webtop.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
