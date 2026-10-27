"""Arbiter mit Attrappen für Docker und Engines: Wechsel, CPU-Engine, LLM, Reset."""
import os, sys, json
os.environ["TTS_ENGINES"] = "qwen=http://qwen:8880|pm-qwen-tts,f5=http://f5:8880|pm-f5-tts,kokoro=http://kokoro:8880|pm-kokoro-tts|cpu"
os.environ["TTS_IDLE_LINGER_SECONDS"] = "0"
os.environ["TTS_STARTUP_TIMEOUT"] = "3"
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import httpx, docker

running = {"pm-qwen-tts": False, "pm-f5-tts": False, "pm-kokoro-tts": True}
events = []

class C:
    def __init__(s, n): s.name = n
    def reload(s): s.status = "running" if running[s.name] else "exited"
    def start(s): running[s.name] = True; events.append(f"start {s.name}")
    def stop(s, timeout=10): running[s.name] = False; events.append(f"stop {s.name}")
class Cs:
    def get(s, n):
        if n not in running: raise docker.errors.NotFound("x")
        return C(n)
class D:
    containers = Cs()
    def close(s): pass
docker.from_env = lambda: D()

def handler(req: httpx.Request):
    host = req.url.host
    if req.url.path == "/health":
        return httpx.Response(200 if host == "ollama" or running.get(f"pm-{host}-tts") else 503, json={})
    if host == "ollama":
        if req.url.path == "/api/ps": return httpx.Response(200, json={"models": [{"name": "gemma4:e4b"}]})
        events.append(f"ollama {req.url.path} {json.loads(req.content or b'{}').get('keep_alive')}")
        return httpx.Response(200, stream=httpx.ByteStream(b"{}"), headers={"content-type": "application/json"})
    events.append(f"speech {host}")
    return httpx.Response(200, stream=httpx.ByteStream(b"RIFFxxxx"), headers={"content-type": "audio/wav"})

orig = httpx.AsyncClient
httpx.AsyncClient = lambda **kw: orig(transport=httpx.MockTransport(handler), **kw)

import main
from fastapi.testclient import TestClient
with TestClient(main.app) as c:
    r = c.post("/tts/f5/v1/audio/speech", json={"input": "Hallo"}); assert r.status_code == 200 and r.content == b"RIFFxxxx", r.text
    assert "start pm-f5-tts" in events and "speech f5" in events, events
    events.clear(); running["pm-f5-tts"] = True
    r = c.post("/v1/audio/speech", json={"input": "x"}); assert r.status_code == 200
    assert events.index("stop pm-f5-tts") < events.index("start pm-qwen-tts") < events.index("speech qwen"), events
    events.clear()
    r = c.post("/tts/kokoro/v1/audio/speech", json={"input": "x"}); assert r.status_code == 200
    assert events == ["speech kokoro"], events
    events.clear(); running["pm-qwen-tts"] = True
    r = c.post("/api/chat", json={"model": "gemma4:e4b", "messages": []}); assert r.status_code == 200
    assert "stop pm-qwen-tts" in events and "stop pm-kokoro-tts" not in events, events
    r = c.post("/tts/nope/v1/audio/speech", json={}); assert r.status_code == 404
    st = c.get("/status").json(); assert set(st["engines"]) == {"qwen", "f5", "kokoro"}, st
    running["pm-f5-tts"] = False
    r = c.post("/admin/gpu/reset"); assert r.status_code == 200, r.text
    print("ARBITER OK", r.json()["tts_qwen"]["healthy"])
