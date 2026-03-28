"""
Rsync Wrapper — Wraps the rsync binary for push/pull file synchronization.
Builds SSH connection strings from decrypted settings.
"""

import subprocess
import shlex
from dataclasses import dataclass
from typing import Optional, Callable


@dataclass
class RsyncResult:
    """Result of an rsync operation."""
    success: bool
    return_code: int
    output: str
    error: str


class RsyncWrapper:
    """
    Wraps `rsync -avz --delete` for push/pull operations.
    Builds SSH options from server settings.
    """

    def __init__(self, settings: dict):
        self.ssh_user = settings.get("ssh_user", "")
        self.ssh_key_path = settings.get("ssh_key_path", "")
        self.server_host = settings.get("tailscale_ip", settings.get("server_host", ""))

    def _ssh_cmd(self) -> str:
        """Build the SSH command string for rsync -e flag."""
        parts = ["ssh"]
        if self.ssh_key_path:
            parts.append(f"-i {shlex.quote(self.ssh_key_path)}")
        parts.append("-o StrictHostKeyChecking=no")
        return " ".join(parts)

    def _remote_path(self, path: str) -> str:
        """Build user@host:path string."""
        return f"{self.ssh_user}@{self.server_host}:{path}"

    def push(
        self,
        local_path: str,
        remote_path: str,
        on_progress: Optional[Callable[[str], None]] = None,
        extra_args: Optional[list[str]] = None,
    ) -> RsyncResult:
        """
        Push local directory to remote server.
        rsync -avz --delete <local> <remote>
        """
        cmd = [
            "rsync", "-avz", "--delete", "--progress",
            "-e", self._ssh_cmd(),
        ]
        if extra_args:
            cmd.extend(extra_args)

        # Ensure trailing slash for directory sync
        local = local_path.rstrip("/") + "/"
        remote = self._remote_path(remote_path)
        cmd.extend([local, remote])

        return self._run(cmd, on_progress)

    def pull(
        self,
        remote_path: str,
        local_path: str,
        on_progress: Optional[Callable[[str], None]] = None,
        extra_args: Optional[list[str]] = None,
    ) -> RsyncResult:
        """
        Pull remote directory to local machine.
        rsync -avz --delete <remote> <local>
        """
        cmd = [
            "rsync", "-avz", "--delete", "--progress",
            "-e", self._ssh_cmd(),
        ]
        if extra_args:
            cmd.extend(extra_args)

        remote = self._remote_path(remote_path.rstrip("/") + "/")
        local = local_path.rstrip("/") + "/"
        cmd.extend([remote, local])

        return self._run(cmd, on_progress)

    def _run(
        self,
        cmd: list[str],
        on_progress: Optional[Callable[[str], None]] = None,
    ) -> RsyncResult:
        """Execute rsync command and optionally stream progress."""
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

        output_lines = []
        if proc.stdout:
            for line in iter(proc.stdout.readline, ""):
                if not line:
                    break
                stripped = line.rstrip("\n")
                output_lines.append(stripped)
                if on_progress:
                    on_progress(stripped)

        stderr = proc.stderr.read() if proc.stderr else ""
        proc.wait()

        return RsyncResult(
            success=proc.returncode == 0,
            return_code=proc.returncode,
            output="\n".join(output_lines),
            error=stderr,
        )
