import asyncio
import websockets

async def test_ws():
    async with websockets.connect("ws://localhost:8100/ws/stats") as ws:
        print("Connected to sidecar")
        while True:
            msg = await ws.recv()
            print("Received from sidecar:", msg)

asyncio.run(test_ws())
