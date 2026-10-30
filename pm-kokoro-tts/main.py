"""pm-kokoro-tts: Sidecar mit dem gemeinsamen HTTP-Vertrag aus tts_common, dazu das Sprachpaket."""

from engine import ENGINE
from tts_common.server import create_app

app = create_app(ENGINE)


# Unter /v1/audio, damit der Arbiter es ohne eigenen Weg durchreicht (Kokoro braucht keine GPU)
@app.get("/v1/audio/packs")
async def packs():
    return ENGINE.pack


@app.post("/v1/audio/packs/install")
async def install_pack():
    ENGINE.install_pack()
    return ENGINE.pack
