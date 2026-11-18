"""start | stop | restart | status | check   for the home WEBTOP bot.

  status  writes a report (no passwords, no tokens) to the Desktop and opens it.
  check   tries one WEBTOP sign-in per child (only when asked to).
"""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
LIB = BASE / "lib"
sys.path.insert(0, str(LIB))
from home_runner import PID_FILE, STATUS_FILE, process_alive  # noqa: E402

WIN = os.name == "nt"
PY = Path(sys.executable).with_name("python.exe") if WIN else Path(sys.executable)
PYW = Path(sys.executable).with_name("pythonw.exe") if WIN else Path(sys.executable)
SECRET = re.compile(r"\d{6,}:[A-Za-z0-9_-]{25,}|(PASSWORD|TOKEN)=\S+", re.I)


def runner_pid() -> int:
    try:
        return int(PID_FILE.read_text().strip())
    except (OSError, ValueError):
        return 0


def start() -> None:
    if process_alive(runner_pid()):
        print("The bot is already running.")
        return
    flags = 0x00000008 | 0x08000000 if WIN else 0  # DETACHED_PROCESS | CREATE_NO_WINDOW
    subprocess.Popen([str(PYW), str(LIB / "home_runner.py")], cwd=BASE, creationflags=flags,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     start_new_session=not WIN)
    time.sleep(3)
    print("The bot started." if process_alive(runner_pid()) else "The bot did not start - run status.")


def stop() -> None:
    pids = [runner_pid()]
    try:
        pids += [p.get("pid", 0) for p in json.loads(STATUS_FILE.read_text(encoding="utf-8"))["parts"].values()]
    except (OSError, ValueError, KeyError):
        pass
    for pid in pids:
        if pid and process_alive(pid):
            if WIN:
                subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
            else:
                os.kill(pid, 15)
    for _ in range(20):
        if not any(pid and process_alive(pid) for pid in pids):
            break
        time.sleep(0.5)
    for pid in pids:  # anything still alive after 10 seconds
        if pid and process_alive(pid) and not WIN:
            os.kill(pid, 9)
    print("The bot stopped.")


def tail(path: Path, lines: int = 25) -> str:
    if not path.exists():
        return "(no log yet)"
    text = path.read_text(encoding="utf-8", errors="replace").splitlines()[-lines:]
    return "\n".join(SECRET.sub("[hidden]", line) for line in text)


def status() -> Path:
    out = [f"WEBTOP bot status  {time.strftime('%Y-%m-%d %H:%M:%S')}",
           f"Runner running: {process_alive(runner_pid())}"]
    try:
        snap = json.loads(STATUS_FILE.read_text(encoding="utf-8"))
        out.append(f"Status updated: {snap['updated']}")
        for name, part in snap["parts"].items():
            out.append(f"  {name:8} running={part['running']}  restarts={part['restarts']}  "
                       f"last_exit={part['last_exit']}  started={part['started']}")
    except (OSError, ValueError, KeyError):
        out.append("No status file yet.")
    for log in sorted((BASE / "logs").glob("*.log")):
        out += ["", f"----- {log.stem} (last lines) -----", tail(log)]
    desktop = Path(os.environ.get("USERPROFILE", str(Path.home()))) / "Desktop"
    if WIN:  # the real Desktop, also when OneDrive moved it
        import ctypes
        buf = ctypes.create_unicode_buffer(260)
        if ctypes.windll.shell32.SHGetFolderPathW(None, 0x10, None, 0, buf) == 0:
            desktop = Path(buf.value)
    report = (desktop if desktop.exists() else BASE) / "webtop-status.txt"
    report.write_text("\n".join(out) + "\n", encoding="utf-8-sig")
    print(f"Report written: {report}")
    if WIN:
        subprocess.Popen(["notepad.exe", str(report)])
    return report


def check() -> None:
    for env in sorted((BASE / "kids").glob("*/.env")):
        print(f"=== {env.parent.name} ===", flush=True)
        subprocess.run([str(PY), str(LIB / "check_login.py")], cwd=env.parent,
                       env={**os.environ, "PYTHONIOENCODING": "utf-8", "TZ": "Asia/Jerusalem"})
        print()


if __name__ == "__main__":
    command = (sys.argv[1:] or ["status"])[0]
    actions = {"start": start, "stop": stop, "status": status, "check": check,
               "restart": lambda: (stop(), start())}
    if command not in actions:
        sys.exit(__doc__)
    actions[command]()
