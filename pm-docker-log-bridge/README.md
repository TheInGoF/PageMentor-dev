# pm-docker-log-bridge

Tiny HTTP service that streams Docker container logs to clients
without their own docker socket access.

Used by PageMentor's Logs page to mirror the `pm-docling` container's
logs into the in-app log feed (the NAS-side `pm-app` can't reach the
GPU host's docker socket directly).

## API

`GET /logs/<container>?since=<unix-ms>&tail=<n>`

Returns:

```json
{
  "container": "pm-docling",
  "lines": [
    { "ts": 1731841234567, "stream": "stdout", "message": "..." },
    { "ts": 1731841234890, "stream": "stderr", "message": "..." }
  ]
}
```

- `since`: only lines newer than this timestamp (ms). Default: 60s lookback.
- `tail`: cap N lines. Default 200, hard max 2000.

`GET /health` → `{ "status": "ok" }`.

## Auth

Optional `LOG_BRIDGE_TOKEN` env var. When set, clients must send
`Authorization: Bearer <token>`. Without it, the bridge is open to
anyone on the docker network — same trust model as the other internal
services in the PageMentor stack.

## Deployment

See the `docker-compose.gpu-host.example.yaml` block at the top of the
PageMentor repo. The container needs `/var/run/docker.sock` mounted
read-only and a port published for the NAS to reach it.

## Build

```bash
docker build -t ghcr.io/theingof/pm-docker-log-bridge-dev:latest .
docker push ghcr.io/theingof/pm-docker-log-bridge-dev:latest
```

CI workflow tag pattern: `log-bridge-v*`.
