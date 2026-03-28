"""
Ledger Manager — Linux Version
Server-side authority for projects.json and backups.json.
Thread-safe JSON read/write with fcntl-based file locking.
"""

import json
import os
import fcntl
from pathlib import Path
from typing import Any, Literal
from datetime import datetime, timezone


# ── File Locking (Linux / fcntl) ─────────────────────────────────────────────

def _lock_shared(f):
    """Acquire a shared (read) lock — Linux."""
    fcntl.flock(f, fcntl.LOCK_SH)


def _lock_exclusive(f):
    """Acquire an exclusive (write) lock — Linux."""
    fcntl.flock(f, fcntl.LOCK_EX)


def _unlock(f):
    """Release lock — Linux."""
    fcntl.flock(f, fcntl.LOCK_UN)


# ── Config ───────────────────────────────────────────────────────────────────

HEAVY_DIR = Path(os.environ.get("HEAVY_DIR", Path.home() / "heavy"))
LEDGERS_DIR = HEAVY_DIR / "ledgers"

LedgerType = Literal["projects", "backups"]

LEDGER_DEFAULTS: dict[LedgerType, dict] = {
    "projects": {},
    "backups": {},
}


def _ledger_path(ledger_type: LedgerType) -> Path:
    return LEDGERS_DIR / f"{ledger_type}.json"


def ensure_ledgers() -> None:
    """Create ledger directory and default files if they don't exist."""
    LEDGERS_DIR.mkdir(parents=True, exist_ok=True)
    for lt, default in LEDGER_DEFAULTS.items():
        path = _ledger_path(lt)
        if not path.exists():
            path.write_text(json.dumps(default, indent=2))


def read_ledger(ledger_type: LedgerType) -> dict:
    """Read a ledger file with shared lock."""
    path = _ledger_path(ledger_type)
    if not path.exists():
        ensure_ledgers()
    with open(path, "r") as f:
        _lock_shared(f)
        try:
            data = json.load(f)
        finally:
            _unlock(f)
    return data


def _write_ledger(ledger_type: LedgerType, data: dict) -> None:
    """Write a ledger file with exclusive lock."""
    path = _ledger_path(ledger_type)
    with open(path, "r+") as f:
        _lock_exclusive(f)
        try:
            f.seek(0)
            f.truncate()
            json.dump(data, f, indent=2)
        finally:
            _unlock(f)


def update_ledger(ledger_type: LedgerType, changeset: dict[str, Any]) -> dict:
    """
    Apply a changeset to a ledger.

    Changeset format:
    {
        "action": "add" | "remove" | "remove_timestamp",
        "key": "project_name" or "backup_category",
        "value": <value to set for add>,
        "timestamp": "2024-01-01T00:00:00" (for remove_timestamp only)
    }

    Returns the updated ledger.
    """
    data = read_ledger(ledger_type)
    action = changeset["action"]
    key = changeset["key"]

    if action == "add":
        if ledger_type == "projects":
            # value is the absolute path
            data[key] = changeset["value"]
        elif ledger_type == "backups":
            # value is {"root_path": str, "timestamp": str} for adding a timestamp
            # or {"root_path": str} for initializing a category
            value = changeset["value"]
            if key not in data:
                data[key] = {
                    "root_path": value["root_path"],
                    "timestamps": [],
                }
            if "timestamp" in value:
                ts = value["timestamp"]
                if ts not in data[key]["timestamps"]:
                    data[key]["timestamps"].append(ts)
                    data[key]["timestamps"].sort(reverse=True)

    elif action == "remove":
        data.pop(key, None)

    elif action == "remove_timestamp":
        if key in data and "timestamps" in data[key]:
            ts = changeset["timestamp"]
            data[key]["timestamps"] = [
                t for t in data[key]["timestamps"] if t != ts
            ]

    _write_ledger(ledger_type, data)
    return data
