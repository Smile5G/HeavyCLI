"""
Command Translation Engine — Translates shorthand HCC syntax into
absolute remote shell commands and local actions.
"""

import re
from dataclasses import dataclass
from typing import Optional, Literal
from datetime import datetime, timezone


ActionType = Literal[
    "execute", "stop", "status",
    "push", "pull", "clone",
    "backup", "get_backup", "pushbackup", "pullbackup",
    "del_project", "del_backup",
    "project",
    "unknown",
]


@dataclass
class TranslatedCommand:
    """Result of translating a shorthand command."""
    action: ActionType
    remote_cmd: Optional[str] = None   # Command to send to server /execute
    server_api: Optional[str] = None   # Server API endpoint to call
    server_body: Optional[dict] = None # Body for the server API call
    local_action: Optional[str] = None # Action the sidecar should take locally
    description: str = ""              # Human-readable description


class CommandTranslator:
    """
    Translates shorthand HCC commands into structured actions.

    Uses project metadata from .heavy.json for environment resolution.
    """

    def __init__(self, server_host: str, server_port: int = 8000):
        self.server_base = f"http://{server_host}:{server_port}"

    def translate(
        self,
        raw_input: str,
        project_meta: Optional[dict] = None,
        project_name: Optional[str] = None,
        project_remote_path: Optional[str] = None,
    ) -> TranslatedCommand:
        """
        Parse shorthand syntax and return a TranslatedCommand.

        project_meta: contents of .heavy.json for the active project
        project_name: name of the active project
        project_remote_path: absolute remote path of the project
        """
        parts = raw_input.strip().split()
        if not parts:
            return TranslatedCommand(action="unknown", description="Empty command")

        cmd = parts[0].lower()

        # ── execute <file> [python <env>] ────────────────────────────────
        if cmd == "execute":
            return self._translate_execute(parts[1:], project_meta, project_remote_path)

        # ── stop / status ────────────────────────────────────────────────
        if cmd == "stop":
            pid = int(parts[1]) if len(parts) > 1 else None
            return TranslatedCommand(
                action="stop",
                server_api="/execute/kill",
                server_body={"pid": pid},
                description=f"Kill process {pid}",
            )

        if cmd == "status":
            pid = int(parts[1]) if len(parts) > 1 else None
            return TranslatedCommand(
                action="status",
                server_api=f"/execute/status/{pid}" if pid else "/execute/list",
                description=f"Status of PID {pid}" if pid else "List all processes",
            )

        # ── push / pull ──────────────────────────────────────────────────
        if cmd == "push":
            return TranslatedCommand(
                action="push",
                local_action="rsync_push",
                description=f"Push project to server via rsync",
            )

        if cmd == "pull":
            if len(parts) > 1 and parts[1] == "-?":
                return TranslatedCommand(
                    action="pull",
                    server_api="/ledger/projects",
                    description="List all remote projects",
                )
            return TranslatedCommand(
                action="pull",
                local_action="rsync_pull",
                description=f"Pull project from server via rsync",
            )

        # ── clone <name> ─────────────────────────────────────────────────
        if cmd == "clone":
            name = parts[1] if len(parts) > 1 else ""
            return TranslatedCommand(
                action="clone",
                local_action="rsync_pull",
                description=f"Clone project '{name}' from server",
            )

        # ── backup ───────────────────────────────────────────────────────
        if cmd == "backup":
            ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
            return TranslatedCommand(
                action="backup",
                local_action="rsync_push",
                server_api="/ledger/update",
                server_body={
                    "ledger_type": "backups",
                    "changeset": {
                        "action": "add",
                        "key": project_name or "unknown",
                        "value": {
                            "root_path": f"/heavy/backups/{project_name}",
                            "timestamp": ts,
                        },
                    },
                },
                description=f"Backup current project ({ts})",
            )

        # ── get-backup ───────────────────────────────────────────────────
        if cmd == "get-backup":
            if len(parts) == 1 or (len(parts) == 2 and parts[1] == "-?"):
                return TranslatedCommand(
                    action="get_backup",
                    server_api="/ledger/backups",
                    description="List all backup categories",
                )
            if len(parts) >= 3 and parts[2] == "-?":
                return TranslatedCommand(
                    action="get_backup",
                    server_api="/ledger/backups",
                    description=f"List timestamps for backup '{parts[1]}'",
                )
            return TranslatedCommand(
                action="unknown",
                description="Invalid get-backup syntax",
            )

        # ── pushbackup ───────────────────────────────────────────────────
        if cmd == "pushbackup":
            ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
            return TranslatedCommand(
                action="pushbackup",
                server_api="/fs/snapshot",
                server_body={
                    "source": project_remote_path or "",
                    "destination": f"/heavy/backups/{project_name}/{ts}",
                },
                local_action="rsync_push",
                description=f"Server snapshots project, then rsync push new code",
            )

        # ── pullbackup <name> <ts> ───────────────────────────────────────
        if cmd == "pullbackup" and len(parts) >= 3:
            name = parts[1]
            ts = parts[2]
            return TranslatedCommand(
                action="pullbackup",
                server_api="/fs/snapshot",
                server_body={
                    "source": f"/heavy/backups/{name}/{ts}",
                    "destination": f"/heavy/projects/{name}",
                },
                local_action="rsync_pull",
                description=f"Server restores backup '{name}' @ {ts}, then rsync pull",
            )

        # ── del project <name> ───────────────────────────────────────────
        if cmd == "del" and len(parts) >= 3 and parts[1] == "project":
            name = parts[2]
            return TranslatedCommand(
                action="del_project",
                server_api="/fs/cleanup",
                server_body={
                    "path": f"/heavy/projects/{name}",
                    "ledger_type": "projects",
                    "changeset": {"action": "remove", "key": name},
                },
                local_action="close_tab",
                description=f"Delete project '{name}': remove dir, update ledger, close tab",
            )

        # ── del backup <name> <ts> ───────────────────────────────────────
        if cmd == "del" and len(parts) >= 3 and parts[1] == "backup":
            name = parts[2]
            if len(parts) >= 4 and parts[3] == "-a":
                # Delete entire category
                return TranslatedCommand(
                    action="del_backup",
                    server_api="/fs/cleanup",
                    server_body={
                        "path": f"/heavy/backups/{name}",
                        "ledger_type": "backups",
                        "changeset": {"action": "remove", "key": name},
                    },
                    description=f"Delete ALL backups for '{name}'",
                )
            if len(parts) >= 4:
                ts = parts[3]
                return TranslatedCommand(
                    action="del_backup",
                    server_api="/fs/cleanup",
                    server_body={
                        "path": f"/heavy/backups/{name}/{ts}",
                        "ledger_type": "backups",
                        "changeset": {
                            "action": "remove_timestamp",
                            "key": name,
                            "timestamp": ts,
                        },
                    },
                    description=f"Delete backup '{name}' @ {ts}",
                )

        # ── project <path> ───────────────────────────────────────────────
        if cmd == "project" or cmd == "heavy" and len(parts) >= 2 and parts[1] == "project":
            idx = 1 if cmd == "project" else 2
            path = parts[idx] if len(parts) > idx else "."
            return TranslatedCommand(
                action="project",
                local_action="open_tab",
                description=f"Open project tab for '{path}'",
            )

        return TranslatedCommand(
            action="unknown",
            description=f"Unrecognized command: {raw_input}",
        )

    def _translate_execute(
        self,
        args: list[str],
        project_meta: Optional[dict],
        project_remote_path: Optional[str],
    ) -> TranslatedCommand:
        """Translate 'execute <file> [python <env>]' command."""
        if not args:
            return TranslatedCommand(action="unknown", description="execute requires a file")

        filename = args[0]

        # Determine Python environment
        env_path = ""
        if len(args) >= 3 and args[1].lower() == "python":
            env_path = args[2]
        elif project_meta and "environment" in project_meta:
            env_path = project_meta["environment"]

        # Build the full remote command
        if env_path:
            python_bin = f"{env_path}/bin/python"
        else:
            python_bin = "python3"

        cwd = project_remote_path or "/heavy/projects"
        full_cmd = f"{python_bin} {filename}"

        return TranslatedCommand(
            action="execute",
            remote_cmd=full_cmd,
            server_api="/execute",
            server_body={"cmd": full_cmd, "cwd": cwd},
            description=f"Execute '{filename}' with {python_bin} in {cwd}",
        )
