"""Keeps the WEBTOP bot running on a home computer (Windows or Linux).

Starts the Telegram router and one sender per child, restarts any that stop,
and writes logs/ and status.json for the status report. Started (hidden) by
control.py; only one copy runs at a time.
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
LIB = BASE / "lib"
LOGS = BASE / "logs"
PID_FILE = BASE / "runner.pid"
STATUS_FILE = BASE / "status.json"
NO_WINDOW = 0x08000000 if os.name == "nt" else 0
PYTHON = Path(sys.executable)
if PYTHON.name.lower() == "pythonw.exe":
    PYTHON = PYTHON.with_name("python.exe")


def process_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes
        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)  # QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        code = ctypes.c_ulong()
        ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
        ctypes.windll.kernel32.CloseHandle(handle)
        return code.value == 259  # STILL_ACTIVE
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def components():
    yield "router", BASE, [str(PYTHON), str(LIB / "router.py")]
    for env in sorted((BASE / "kids").glob("*/.env")):
        yield env.parent.name, env.parent, [str(PYTHON), str(LIB / "kid_worker.py")]


def open_log(name: str):
    path = LOGS / f"{name}.log"
    if path.exists() and path.stat().st_size > 2_000_000:
        path.replace(path.with_suffix(".log.1"))
    return open(path, "a", encoding="utf-8", errors="replace")


def main() -> None:
    LOGS.mkdir(exist_ok=True)
    try:
        if process_alive(int(PID_FILE.read_text().strip())):
            return  # already running
    except (OSError, ValueError):
        pass
    PID_FILE.write_text(str(os.getpid()))

    env = {**os.environ, "WEBTOP_BASE": str(BASE), "PYTHONUNBUFFERED": "1",
           "PYTHONIOENCODING": "utf-8", "TZ": "Asia/Jerusalem"}
    procs: dict[str, subprocess.Popen] = {}
    info: dict[str, dict] = {}
    while True:
        for name, folder, cmd in components():
            proc = procs.get(name)
            state = info.setdefault(name, {"restarts": -1, "last_exit": None, "started": 0})
            if proc is not None and proc.poll() is None:
                continue
            if proc is not None:
                state["last_exit"] = proc.returncode
                if time.time() - state["started"] < 60:
                    continue  # stopped quickly: wait a minute before trying again
            log = open_log(name)
            log.write(f"\n===== start {time.strftime('%Y-%m-%d %H:%M:%S')} =====\n")
            log.flush()
            procs[name] = subprocess.Popen(cmd, cwd=folder, env=env, stdout=log, stderr=subprocess.STDOUT,
                                           stdin=subprocess.DEVNULL, creationflags=NO_WINDOW)
            state.update(pid=procs[name].pid, started=time.time(), restarts=state["restarts"] + 1)
        snapshot = {
            "runner_pid": os.getpid(), "updated": time.strftime("%Y-%m-%d %H:%M:%S"),
            "parts": {n: {**s, "running": procs.get(n) is not None and procs[n].poll() is None,
                          "started": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(s["started"]))}
                      for n, s in info.items()},
        }
        STATUS_FILE.write_text(json.dumps(snapshot, ensure_ascii=False, indent=1), encoding="utf-8")
        time.sleep(10)


if __name__ == "__main__":
    main()
