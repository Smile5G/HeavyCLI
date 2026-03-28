"""
Heavy Control Center — Receiver (macOS Version)
FastAPI application: the thin, authoritative server agent.
"""

import asyncio
import json
import os
import shutil
from pathlib import Path
from typing import Optional

import psutil
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import ledger_manager
from .ledger_manager import LedgerType, HEAVY_DIR
from .shell_handler import process_manager

app = FastAPI(title="Heavy Control Center — Receiver (macOS)", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Startup ──────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    ledger_manager.ensure_ledgers()
    # Ensure standard directories exist
    (HEAVY_DIR / "projects").mkdir(parents=True, exist_ok=True)
    (HEAVY_DIR / "backups").mkdir(parents=True, exist_ok=True)
    (HEAVY_DIR / "logs").mkdir(parents=True, exist_ok=True)


# ── Models ───────────────────────────────────────────────────────────────────

class ExecuteRequest(BaseModel):
    cmd: str
    cwd: Optional[str] = None

class ExecuteResponse(BaseModel):
    pid: int

class KillRequest(BaseModel):
    pid: int

class LedgerUpdateRequest(BaseModel):
    ledger_type: LedgerType
    changeset: dict

class SnapshotRequest(BaseModel):
    """For internal server-side copy operations."""
    source: str
    destination: str

class CleanupRequest(BaseModel):
    """For deletion operations."""
    path: str
    ledger_type: Optional[LedgerType] = None
    changeset: Optional[dict] = None


# ── Execute Endpoints ────────────────────────────────────────────────────────

@app.post("/execute", response_model=ExecuteResponse)
async def execute_command(req: ExecuteRequest):
    """Spawn a non-blocking subprocess. Returns its PID."""
    pid = process_manager.spawn(req.cmd, cwd=req.cwd)
    return ExecuteResponse(pid=pid)


@app.get("/execute/status/{pid}")
async def process_status(pid: int):
    """Get the status of a running process."""
    info = process_manager.status(pid)
    if info is None:
        raise HTTPException(status_code=404, detail=f"PID {pid} not found")
    return info


@app.post("/execute/kill")
async def kill_process(req: KillRequest):
    """Kill a running process by PID."""
    success = process_manager.kill(req.pid)
    if not success:
        raise HTTPException(status_code=404, detail=f"PID {req.pid} not found")
    return {"killed": True, "pid": req.pid}


@app.get("/execute/list")
async def list_processes():
    """List all tracked processes."""
    return process_manager.list_all()


# ── Stats WebSocket ──────────────────────────────────────────────────────────

@app.websocket("/stats")
async def stats_websocket(websocket: WebSocket):
    """Stream system metrics via WebSocket."""
    await websocket.accept()
    try:
        while True:
            cpu_percent = psutil.cpu_percent(interval=0)
            mem = psutil.virtual_memory()
            disk = psutil.disk_usage("/")

            stats = {
                "cpu_percent": cpu_percent,
                "ram_total_gb": round(mem.total / (1024**3), 2),
                "ram_used_gb": round(mem.used / (1024**3), 2),
                "ram_percent": mem.percent,
                "disk_total_gb": round(disk.total / (1024**3), 2),
                "disk_used_gb": round(disk.used / (1024**3), 2),
                "disk_percent": disk.percent,
                "gpu": _get_gpu_stats(),
            }

            await websocket.send_json(stats)
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        pass


def _get_gpu_stats() -> Optional[dict]:
    """Try to get GPU stats via gputil, return None if unavailable."""
    try:
        import GPUtil
        gpus = GPUtil.getGPUs()
        if gpus:
            g = gpus[0]
            return {
                "name": g.name,
                "load_percent": round(g.load * 100, 1),
                "memory_used_mb": round(g.memoryUsed, 0),
                "memory_total_mb": round(g.memoryTotal, 0),
                "temperature": g.temperature,
            }
    except ImportError:
        pass
    return None


# ── Ledger Endpoints ─────────────────────────────────────────────────────────

@app.get("/ledger/{ledger_type}")
async def get_ledger(ledger_type: LedgerType):
    """Return the current state of a ledger."""
    return ledger_manager.read_ledger(ledger_type)


@app.post("/ledger/update")
async def update_ledger(req: LedgerUpdateRequest):
    """Apply a changeset to a ledger and return the updated version."""
    updated = ledger_manager.update_ledger(req.ledger_type, req.changeset)
    return updated


# ── Filesystem Endpoints ─────────────────────────────────────────────────────

@app.post("/fs/snapshot")
async def filesystem_snapshot(req: SnapshotRequest):
    """
    Perform a server-side directory copy (SSD-to-SSD).
    Used for pushbackup/pullbackup to avoid network transfer.
    """
    src = Path(req.source)
    dst = Path(req.destination)

    if not src.exists():
        raise HTTPException(status_code=404, detail=f"Source not found: {req.source}")

    dst.parent.mkdir(parents=True, exist_ok=True)

    # Use shutil.copytree for directory copy
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)

    return {"status": "ok", "source": str(src), "destination": str(dst)}


@app.delete("/fs/cleanup")
async def filesystem_cleanup(req: CleanupRequest):
    """
    Delete a directory/file and optionally update the ledger.
    Handles: del project, del backup (single or all).
    """
    target = Path(req.path)

    if target.exists():
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()

    # If a ledger update is also requested, apply it
    updated_ledger = None
    if req.ledger_type and req.changeset:
        updated_ledger = ledger_manager.update_ledger(req.ledger_type, req.changeset)

    return {
        "deleted": str(target),
        "existed": target.exists() is False,  # True if we successfully removed it
        "ledger": updated_ledger,
    }


# ── Logs Endpoint ────────────────────────────────────────────────────────────

@app.get("/logs")
async def list_logs():
    """List available log files."""
    logs_dir = HEAVY_DIR / "logs"
    if not logs_dir.exists():
        return []
    return sorted(
        [f.name for f in logs_dir.iterdir() if f.is_file()],
        reverse=True,
    )


@app.get("/logs/{filename}")
async def get_log(filename: str):
    """Read a specific log file."""
    log_path = HEAVY_DIR / "logs" / filename
    if not log_path.exists():
        raise HTTPException(status_code=404, detail="Log not found")
    return {"filename": filename, "content": log_path.read_text()}


# ── Health ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "heavy-receiver", "platform": "macos"}
