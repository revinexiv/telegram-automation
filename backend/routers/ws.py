import asyncio
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)
router = APIRouter()

# Set of connected WebSocket clients
_connections: set[WebSocket] = set()


async def broadcast(message: dict):
    """Kirim message ke semua connected dashboard."""
    if not _connections:
        return
    data = json.dumps(message)
    dead = set()
    for ws in _connections:
        try:
            await ws.send_text(data)
        except Exception:
            dead.add(ws)
    _connections.difference_update(dead)


@router.websocket("/ws/logs")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    _connections.add(websocket)
    logger.info(f"WebSocket connected. Total: {len(_connections)}")
    try:
        # Kirim pesan selamat datang
        await websocket.send_text(json.dumps({"type": "connected", "message": "Dashboard terhubung"}))
        # Keep connection alive dengan ping
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                # Handle ping dari client
                if data == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
            except asyncio.TimeoutError:
                # Kirim ping ke client setiap 30 detik
                await websocket.send_text(json.dumps({"type": "ping"}))
    except WebSocketDisconnect:
        pass
    finally:
        _connections.discard(websocket)
        logger.info(f"WebSocket disconnected. Total: {len(_connections)}")
