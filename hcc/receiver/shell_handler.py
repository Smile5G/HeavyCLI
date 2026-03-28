"""
Shell Handler — Subprocess/PID management for remote command execution.
Tracks spawned processes, captures output, and provides status/kill APIs.
"""

import subprocess
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ManagedProcess:
    """A tracked subprocess with output capture."""
    pid: int
    cmd: str
    process: subprocess.Popen
    started_at: float = field(default_factory=time.time)
    stdout_buffer: deque = field(default_factory=lambda: deque(maxlen=1000))
    stderr_buffer: deque = field(default_factory=lambda: deque(maxlen=500))
    _reader_thread: Optional[threading.Thread] = field(default=None, repr=False)

    @property
    def running(self) -> bool:
        return self.process.poll() is None

    @property
    def exit_code(self) -> Optional[int]:
        return self.process.poll()

    def to_dict(self) -> dict:
        return {
            "pid": self.pid,
            "cmd": self.cmd,
            "running": self.running,
            "exit_code": self.exit_code,
            "uptime_seconds": round(time.time() - self.started_at, 1),
            "stdout_tail": list(self.stdout_buffer)[-50:],
            "stderr_tail": list(self.stderr_buffer)[-20:],
        }


class ProcessManager:
    """Manages spawned subprocesses, providing spawn/kill/status APIs."""

    def __init__(self):
        self._processes: dict[int, ManagedProcess] = {}
        self._lock = threading.Lock()

    def _capture_output(self, mp: ManagedProcess) -> None:
        """Background thread to read stdout/stderr into ring buffers."""
        proc = mp.process
        if proc.stdout:
            for line in iter(proc.stdout.readline, ""):
                if not line:
                    break
                mp.stdout_buffer.append(line.rstrip("\n"))
        if proc.stderr:
            for line in iter(proc.stderr.readline, ""):
                if not line:
                    break
                mp.stderr_buffer.append(line.rstrip("\n"))

    def spawn(self, cmd: str, cwd: Optional[str] = None) -> int:
        """
        Spawn a non-blocking subprocess.
        Returns the PID.
        """
        proc = subprocess.Popen(
            cmd,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=cwd,
        )

        mp = ManagedProcess(pid=proc.pid, cmd=cmd, process=proc)

        # Start output capture in background
        reader = threading.Thread(target=self._capture_output, args=(mp,), daemon=True)
        mp._reader_thread = reader
        reader.start()

        with self._lock:
            self._processes[proc.pid] = mp

        return proc.pid

    def status(self, pid: int) -> Optional[dict]:
        """Get status of a tracked process."""
        with self._lock:
            mp = self._processes.get(pid)
        if mp is None:
            return None
        return mp.to_dict()

    def kill(self, pid: int) -> bool:
        """Kill a tracked process. Returns True if successfully killed."""
        with self._lock:
            mp = self._processes.get(pid)
        if mp is None:
            return False
        try:
            mp.process.terminate()
            mp.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            mp.process.kill()
        return True

    def list_all(self) -> list[dict]:
        """List all tracked processes."""
        with self._lock:
            return [mp.to_dict() for mp in self._processes.values()]

    def cleanup_finished(self) -> int:
        """Remove finished processes from tracking. Returns count removed."""
        with self._lock:
            finished = [pid for pid, mp in self._processes.items() if not mp.running]
            for pid in finished:
                del self._processes[pid]
            return len(finished)


# Singleton instance
process_manager = ProcessManager()
