"""pm-f5-tts: Sidecar mit dem gemeinsamen HTTP-Vertrag aus tts_common."""

from engine import ENGINE
from tts_common.server import create_app

app = create_app(ENGINE)
