import asyncio
import websockets

async def test_ws():
    async with websockets.connect("ws://localhost:8000/stats") as ws:
        print("Connected to receiver")
        msg = await ws.recv()
        print("Received:", msg)

asyncio.run(test_ws())
