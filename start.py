#!/usr/bin/env python3
"""
HCC Launcher — Starts all services with a single command.

Usage:
    python start.py              # Start sidecar + UI (client mode)
    python start.py --all        # Start receiver + sidecar + UI
    python start.py --server     # Start receiver only (for the remote machine)
"""

import subprocess
import sys
import os
import signal
import time
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).parent
SIDECAR_DIR = ROOT / "hcc" / "client-sidecar"
UI_DIR = ROOT / "hcc" / "client-ui"

# ── Auto-detect platform receiver ────────────────────────────────────────────
def _get_receiver_module() -> str:
    """Return the correct receiver module path for the current platform."""
    if sys.platform == "darwin":
        return "hcc.receiver_macos.main:app"
    elif sys.platform == "win32":
        return "hcc.receiver_windows.main:app"
    else:
        return "hcc.receiver_linux.main:app"

def _get_receiver_dir() -> Path:
    """Return the correct receiver directory for the current platform."""
    if sys.platform == "darwin":
        return ROOT / "hcc" / "receiver_macos"
    elif sys.platform == "win32":
        return ROOT / "hcc" / "receiver_windows"
    else:
        return ROOT / "hcc" / "receiver_linux"

RECEIVER_DIR = _get_receiver_dir()

processes: list[subprocess.Popen] = []


def start(name: str, cmd: list[str], cwd: Path, env: Optional[dict] = None):
    """Start a subprocess and track it."""
    merged_env = {**os.environ, **(env or {})}
    print(f"  ▸ {name}: {' '.join(cmd)}")
    proc = subprocess.Popen(cmd, cwd=cwd, env=merged_env)
    processes.append(proc)
    return proc


def install_deps():
    """Install Python + Node dependencies if needed."""
    # Python deps
    for req in [RECEIVER_DIR / "requirements.txt", SIDECAR_DIR / "requirements.txt"]:
        if req.exists():
            subprocess.run(
                [sys.executable, "-m", "pip", "install", "-q", "-r", str(req)],
                check=True,
            )
    # Node deps
    if UI_DIR.exists() and not (UI_DIR / "node_modules").exists():
        print("  ▸ Installing UI dependencies...")
        subprocess.run(["npm", "install"], cwd=UI_DIR, check=True)


def shutdown(sig=None, frame=None):
    """Gracefully kill all child processes."""
    print("\n⏹  Shutting down all services...")
    for p in reversed(processes):
        try:
            p.terminate()
            p.wait(timeout=5)
        except (subprocess.TimeoutExpired, OSError):
            p.kill()
    sys.exit(0)


def main():
    mode = "client"
    if "--all" in sys.argv:
        mode = "all"
    elif "--server" in sys.argv:
        mode = "server"

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    print("━" * 50)
    print("  HCC — Heavy Control Center Launcher")
    print("━" * 50)

    # Install dependencies
    print("\n📦 Checking dependencies...")
    install_deps()

    print(f"\n🚀 Starting services (mode: {mode})...\n")

    # ── Receiver (server) ────────────────────────────────────────────────
    if mode in ("all", "server"):
        receiver_module = _get_receiver_module()
        start(
            "Receiver (port 8000)",
            [sys.executable, "-m", "uvicorn", receiver_module,
             "--host", "0.0.0.0", "--port", "8000"],
            cwd=ROOT,
        )

    # ── Sidecar ──────────────────────────────────────────────────────────
    if mode in ("all", "client"):
        start(
            "Sidecar  (port 8100)",
            [sys.executable, "-m", "uvicorn", "hcc.client_sidecar.main:app",
             "--host", "127.0.0.1", "--port", "8100"],
            cwd=ROOT,
        )

    # ── UI Dev Server ────────────────────────────────────────────────────
    if mode in ("all", "client"):
        start(
            "UI       (port 5173)",
            ["npm", "run", "dev"],
            cwd=UI_DIR,
        )

    print()
    print("━" * 50)
    if mode != "server":
        print("  ✓ Open http://localhost:5173 in your browser")
    print("  ✓ Press Ctrl+C to stop all services")
    print("━" * 50)

    # Wait for all processes
    try:
        while True:
            for p in processes:
                ret = p.poll()
                if ret is not None:
                    print(f"\n⚠  Process exited with code {ret}")
            time.sleep(1)
    except KeyboardInterrupt:
        shutdown()


if __name__ == "__main__":
    main()
