"""
Heavy Control Center — Client Sidecar
FastAPI backend bridging the React UI to the remote server.
Handles authentication, command translation, rsync, and WebSocket forwarding.
"""

import asyncio
import json
import os
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .crypto_vault import CryptoVault, VaultError
from .rsync_wrapper import RsyncWrapper
from .translator import CommandTranslator

app = FastAPI(title="Heavy Control Center — Client Sidecar", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Global State ─────────────────────────────────────────────────────────────

vault = CryptoVault()
_translator: Optional[CommandTranslator] = None
_rsync: Optional[RsyncWrapper] = None
_server_base: str = "http://127.0.0.1:8000"


def _ensure_unlocked():
    """Dependency: ensure vault is unlocked before API calls."""
    if not vault.is_unlocked:
        raise HTTPException(status_code=401, detail="Vault is locked. Authenticate first.")


def _get_http_client() -> httpx.AsyncClient:
    """Get an async HTTP client pointed at the server."""
    return httpx.AsyncClient(base_url=_server_base, timeout=30.0)


# ── Models ───────────────────────────────────────────────────────────────────

class PinRequest(BaseModel):
    pin: str

class InitRequest(BaseModel):
    pin: str
    settings: Optional[dict] = None

class CommandRequest(BaseModel):
    raw_command: str
    project_name: Optional[str] = None
    project_remote_path: Optional[str] = None
    project_meta: Optional[dict] = None

class SettingsUpdate(BaseModel):
    updates: dict

class ChangePinRequest(BaseModel):
    old_pin: str
    new_pin: str


# ── Auth Endpoints ───────────────────────────────────────────────────────────

@app.get("/auth/status")
async def auth_status():
    """Check vault state."""
    return {
        "initialized": vault.is_initialized,
        "unlocked": vault.is_unlocked,
    }


@app.post("/auth/init")
async def auth_init(req: InitRequest):
    """First-run: create vault with PIN."""
    try:
        settings = vault.initialize(req.pin, req.settings)
        _init_services(settings)
        return {"success": True, "settings": settings}
    except VaultError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/auth/unlock")
async def auth_unlock(req: PinRequest):
    """Subsequent runs: unlock vault with PIN."""
    try:
        settings = vault.unlock(req.pin)
        _init_services(settings)
        return {"success": True, "settings": _safe_settings(settings)}
    except VaultError as e:
        raise HTTPException(status_code=403, detail=str(e))


@app.post("/auth/lock")
async def auth_lock():
    """Lock the vault (clear memory)."""
    vault.lock()
    return {"success": True}


@app.post("/auth/change-pin")
async def auth_change_pin(req: ChangePinRequest):
    """Change the vault PIN."""
    try:
        vault.change_pin(req.old_pin, req.new_pin)
        return {"success": True}
    except VaultError as e:
        raise HTTPException(status_code=403, detail=str(e))


# ── Settings ─────────────────────────────────────────────────────────────────

@app.get("/settings", dependencies=[Depends(_ensure_unlocked)])
async def get_settings():
    """Return decrypted settings (sensitive fields masked)."""
    return _safe_settings(vault.settings)


@app.post("/settings", dependencies=[Depends(_ensure_unlocked)])
async def update_settings(req: SettingsUpdate):
    """Update settings and re-encrypt."""
    try:
        updated = vault.update_settings(req.updates)
        _init_services(updated)
        return {"success": True, "settings": _safe_settings(updated)}
    except VaultError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Command Engine ───────────────────────────────────────────────────────────

@app.post("/command", dependencies=[Depends(_ensure_unlocked)])
async def execute_command(req: CommandRequest):
    """
    Translate a shorthand command, dispatch to server, and return result.
    """
    if _translator is None:
        raise HTTPException(status_code=500, detail="Translator not initialized")

    translated = _translator.translate(
        req.raw_command,
        project_meta=req.project_meta,
        project_name=req.project_name,
        project_remote_path=req.project_remote_path,
    )

    result = {
        "action": translated.action,
        "description": translated.description,
        "local_action": translated.local_action,
    }

    # Dispatch to server API if needed
    if translated.server_api:
        async with _get_http_client() as client:
            try:
                if translated.server_body:
                    if translated.server_api.startswith("/fs/cleanup"):
                        resp = await client.request(
                            "DELETE", translated.server_api, json=translated.server_body
                        )
                    else:
                        resp = await client.post(
                            translated.server_api, json=translated.server_body
                        )
                else:
                    resp = await client.get(translated.server_api)
                resp.raise_for_status()
                result["server_response"] = resp.json()
            except httpx.HTTPError as e:
                result["server_error"] = str(e)

    # Execute local rsync if needed
    if translated.local_action and translated.local_action.startswith("rsync_"):
        rsync_result = _handle_rsync(
            translated.local_action,
            req.project_name,
            req.project_remote_path,
        )
        result["rsync"] = rsync_result

    return result


# ── Ledger Proxy ─────────────────────────────────────────────────────────────

@app.get("/ledger/{ledger_type}", dependencies=[Depends(_ensure_unlocked)])
async def proxy_get_ledger(ledger_type: str):
    """Proxy ledger read to server."""
    async with _get_http_client() as client:
        resp = await client.get(f"/ledger/{ledger_type}")
        resp.raise_for_status()
        return resp.json()


@app.post("/ledger/update", dependencies=[Depends(_ensure_unlocked)])
async def proxy_update_ledger(body: dict):
    """Proxy ledger update to server."""
    async with _get_http_client() as client:
        resp = await client.post("/ledger/update", json=body)
        resp.raise_for_status()
        return resp.json()


# ── WebSocket: Server Output Forwarding ──────────────────────────────────────

@app.websocket("/ws/output/{pid}")
async def ws_output(websocket: WebSocket, pid: int):
    """
    Forward process output from server to the React UI.
    Polls the server status endpoint and streams new output lines.
    """
    await websocket.accept()
    seen_lines = 0
    try:
        while True:
            async with _get_http_client() as client:
                try:
                    resp = await client.get(f"/execute/status/{pid}")
                    if resp.status_code == 404:
                        await websocket.send_json({"event": "not_found", "pid": pid})
                        break
                    data = resp.json()
                    stdout = data.get("stdout_tail", [])
                    stderr = data.get("stderr_tail", [])
                    total_lines = stdout + [f"⚠ {err}" for err in stderr]
                    
                    if len(total_lines) > seen_lines:
                        new_lines = total_lines[seen_lines:]
                        for line in new_lines:
                            await websocket.send_json({"event": "output", "line": line})
                        seen_lines = len(total_lines)
                    if not data.get("running", False):
                        await websocket.send_json({
                            "event": "exit",
                            "exit_code": data.get("exit_code"),
                        })
                        break
                except httpx.HTTPError:
                    await websocket.send_json({"event": "error", "detail": "Server unreachable"})
                    break
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        pass


@app.websocket("/ws/stats")
async def ws_stats(websocket: WebSocket):
    """
    Forward server stats WebSocket to the React UI.
    Acts as a relay between the server's /stats WS and the client.
    """
    await websocket.accept()
    import websockets
    try:
        server_ws_url = _server_base.replace("http://", "ws://").replace("https://", "wss://") + "/stats"
        print(f"DEBUG: Connecting to receiver stats at {server_ws_url}...")
        async with websockets.connect(server_ws_url, open_timeout=5) as server_ws:
            print("DEBUG: Receiver stats connected!")
            while True:
                data = await server_ws.recv()
                await websocket.send_text(data)
    except Exception as e:
        print(f"DEBUG: Sidecar stats relay error: {str(e)}")
        try:
            await websocket.close()
        except:
            pass


@app.get("/info", dependencies=[Depends(_ensure_unlocked)])
async def get_info():
    """Return server info (heavy_dir, etc)."""
    async with _get_http_client() as client:
        resp = await client.get("/health")
        resp.raise_for_status()
        data = resp.json()
        return {
            "heavy_dir": data.get("heavy_dir", "/heavy"),
        }


# ── Health ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    """Health check."""
    return {
        "status": "ok",
        "service": "heavy-sidecar",
        "vault_initialized": vault.is_initialized,
        "vault_unlocked": vault.is_unlocked,
    }


# ── Helpers ──────────────────────────────────────────────────────────────────

def _init_services(settings: dict):
    """Initialize translator and rsync wrapper from settings."""
    global _translator, _rsync, _server_base
    host = settings.get("server_host") or "127.0.0.1"
    port = settings.get("server_port") or 8000
    _server_base = f"http://{host}:{port}"
    _translator = CommandTranslator(host, port)
    _rsync = RsyncWrapper(settings)


def _safe_settings(settings: dict) -> dict:
    """Return settings with sensitive fields masked for UI display."""
    safe = dict(settings)
    if "ssh_key_path" in safe and safe["ssh_key_path"]:
        safe["ssh_key_path"] = "***" + safe["ssh_key_path"][-20:]
    if "ssh_password" in safe and safe["ssh_password"]:
        safe["ssh_password"] = "***"
    return safe


def _handle_rsync(action: str, project_name: Optional[str], remote_path: Optional[str]) -> dict:
    """Execute rsync push or pull."""
    if _rsync is None:
        return {"error": "Rsync not initialized"}
    if not project_name or not remote_path:
        return {"error": "No active project"}

    mounts = vault.settings.get("mounts", {})
    if project_name and mounts.get(project_name):
        local_path = mounts[project_name]
    else:
        local_path = str(Path.cwd())

    if action == "rsync_push":
        result = _rsync.push(local_path, remote_path)
    elif action == "rsync_pull":
        result = _rsync.pull(remote_path, local_path)
    else:
        return {"error": f"Unknown rsync action: {action}"}

    return {
        "success": result.success,
        "return_code": result.return_code,
        "output_preview": result.output[:500],
        "error": result.error[:200] if result.error else "",
    }
