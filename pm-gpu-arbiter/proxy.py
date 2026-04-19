"""Streaming reverse-proxy helper.

Ollama streamt NDJSON token-by-token; VibeVoice liefert Binärdaten (WAV/MP3).
Beide Fälle sind durch ``httpx.AsyncClient.stream()`` + ``StreamingResponse``
abgedeckt, ohne den Body zu puffern.
"""

from __future__ import annotations

import logging
from typing import Iterable, Mapping

import httpx
from fastapi import Request
from fastapi.responses import StreamingResponse

log = logging.getLogger("arbiter.proxy")

# Hop-by-hop headers — weder vom Client weiterreichen noch upstream durchreichen.
_HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}

# Response-Header, die der Wire-Layer neu berechnet.
# content-encoding BLEIBT — aiter_raw() liefert gzip-Bytes noch komprimiert,
# der Client dekodiert anhand dieses Headers.
_STRIPPED_RESPONSE_HEADERS = _HOP_BY_HOP | {"content-length"}

# Request-Header, die beim Weiterleiten stören.
_STRIPPED_REQUEST_HEADERS = _HOP_BY_HOP | {"host", "content-length"}


def _filter_headers(headers: Mapping[str, str], drop: Iterable[str]) -> dict[str, str]:
    drop_lc = {h.lower() for h in drop}
    return {k: v for k, v in headers.items() if k.lower() not in drop_lc}


async def proxy_stream(
    client: httpx.AsyncClient,
    upstream_base: str,
    request: Request,
    path: str,
    extra_headers: Mapping[str, str] | None = None,
) -> StreamingResponse:
    """Leitet ``request`` an ``{upstream_base}/{path}`` weiter und streamt die Antwort.

    Funktioniert für non-streaming Responses ebenso wie für NDJSON/SSE-Streams
    und binäre Downloads — httpx liest chunk-weise, FastAPI gibt chunk-weise aus.
    """

    url = f"{upstream_base.rstrip('/')}/{path.lstrip('/')}"
    body = await request.body()

    fwd_headers = _filter_headers(request.headers, _STRIPPED_REQUEST_HEADERS)
    if extra_headers:
        fwd_headers.update({k: v for k, v in extra_headers.items() if v})

    # Ersten Chunk + Status + Headers vom Upstream holen, dann Rest streamen.
    req = client.build_request(
        request.method,
        url,
        content=body,
        headers=fwd_headers,
        params=request.query_params,
    )
    upstream = await client.send(req, stream=True)

    status = upstream.status_code
    resp_headers = _filter_headers(upstream.headers, _STRIPPED_RESPONSE_HEADERS)
    media_type = upstream.headers.get("content-type")

    async def body_iter():
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()

    return StreamingResponse(
        body_iter(),
        status_code=status,
        headers=resp_headers,
        media_type=media_type,
    )
