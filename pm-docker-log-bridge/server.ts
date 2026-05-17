/**
 * pm-docker-log-bridge — minimal HTTP bridge that exposes docker
 * container logs to other services that don't (or shouldn't) have
 * /var/run/docker.sock access of their own.
 *
 * Designed for PageMentor's Logs page: pm-app (running on the NAS,
 * far from the GPU host's docker socket) polls this bridge for the
 * docling container's logs and renders them inline with its own.
 *
 * Single endpoint:
 *   GET /logs/:container?since=<unix-ms>&tail=<n>
 *      → { container, lines: [ { ts, stream, message } ] }
 *
 *   - `since`  — only return lines newer than this timestamp (ms).
 *                Defaults to "last 60 seconds" if omitted, to keep
 *                cold-start responses reasonable.
 *   - `tail`   — limit to the last N lines after the since filter.
 *                Defaults to 200, hard cap at 2000.
 *
 * Auth: optional shared secret via `LOG_BRIDGE_TOKEN` env var. When
 * set, the client must send `Authorization: Bearer <token>`. Without
 * it, the bridge is open to anyone on the docker network — same trust
 * model as docling-serve / qwen-tts in the existing stack.
 *
 * Why Bun: zero-dependency, native unix-socket fetch, builds into a
 * tiny image. The whole runtime is ~80 MB.
 */

const PORT = parseInt(process.env.PORT ?? "8792", 10);
const TOKEN = process.env.LOG_BRIDGE_TOKEN ?? "";
const DOCKER_SOCKET = process.env.DOCKER_SOCKET ?? "/var/run/docker.sock";
const DEFAULT_TAIL = 200;
const MAX_TAIL = 2000;
const DEFAULT_SINCE_MS = 60_000; // 60 s lookback if no since= given

interface LogLine {
  /** Unix ms */
  ts: number;
  /** "stdout" | "stderr" */
  stream: "stdout" | "stderr";
  message: string;
}

/** Calls the docker engine API over the unix socket. Returns the
 *  raw response — caller handles content type. */
function dockerFetch(path: string): Promise<Response> {
  return fetch(`http://docker${path}`, {
    // Bun-specific: route the fetch over a unix domain socket.
    // @ts-expect-error -- Bun's unix option not in stock fetch types
    unix: DOCKER_SOCKET,
  });
}

/** Docker streams logs in a 8-byte-header multiplexed format:
 *
 *    [ STREAM_TYPE 1 byte | 3 bytes pad | LENGTH 4 bytes BE | <payload> ]
 *
 *    STREAM_TYPE: 0 = stdin (unused), 1 = stdout, 2 = stderr
 *
 *  Each payload chunk is plain UTF-8 text that may contain newlines.
 *  We split on newline AFTER demuxing so multi-line log entries from
 *  the same write() stay together-ish.
 *
 *  When the container was started with tty=true (rare for our
 *  workloads), the stream is NOT multiplexed and we just split lines
 *  directly. We detect that by sniffing the first byte: valid stream
 *  type marker (0–2) → demux; anything else → raw. */
function parseDockerLogStream(
  buf: Uint8Array,
  withTimestamps: boolean
): LogLine[] {
  const lines: LogLine[] = [];
  let offset = 0;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const decoder = new TextDecoder();

  // Detect tty mode by checking first byte. tty=true never produces
  // a header so the first byte will be a normal ASCII character.
  const tty = buf.length > 0 && buf[0] > 2;
  if (tty) {
    const text = decoder.decode(buf);
    for (const rawLine of text.split("\n")) {
      if (!rawLine) continue;
      const parsed = splitTimestamp(rawLine, withTimestamps);
      lines.push({
        ts: parsed.ts,
        stream: "stdout",
        message: parsed.message,
      });
    }
    return lines;
  }

  while (offset + 8 <= buf.length) {
    const streamType = buf[offset];
    const len = view.getUint32(offset + 4, false);
    if (offset + 8 + len > buf.length) break;
    const chunk = decoder.decode(buf.subarray(offset + 8, offset + 8 + len));
    offset += 8 + len;
    for (const rawLine of chunk.split("\n")) {
      if (!rawLine) continue;
      const parsed = splitTimestamp(rawLine, withTimestamps);
      lines.push({
        ts: parsed.ts,
        stream: streamType === 2 ? "stderr" : "stdout",
        message: parsed.message,
      });
    }
  }
  return lines;
}

/** Strips the RFC3339-Nano timestamp prefix Docker adds when called
 *  with timestamps=true and converts it to unix-ms. If parsing fails
 *  we fall back to Date.now() — better an approximate timestamp than
 *  dropping the line. */
function splitTimestamp(
  raw: string,
  withTimestamps: boolean
): { ts: number; message: string } {
  if (!withTimestamps) return { ts: Date.now(), message: raw };
  // RFC3339Nano: "2026-05-17T12:34:56.789012345Z message body"
  const m = /^(\S+)\s+(.*)$/.exec(raw);
  if (!m) return { ts: Date.now(), message: raw };
  const ts = Date.parse(m[1]);
  if (!Number.isFinite(ts)) return { ts: Date.now(), message: raw };
  return { ts, message: m[2] };
}

async function handleLogs(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const match = /^\/logs\/([^/?#]+)/.exec(url.pathname);
  if (!match) return new Response("not found", { status: 404 });
  const containerRaw = decodeURIComponent(match[1]);
  // Docker accepts both names and IDs. We allow letters, digits, _, -, .
  // to avoid accidental path injection.
  if (!/^[A-Za-z0-9_.-]+$/.test(containerRaw)) {
    return new Response("invalid container name", { status: 400 });
  }
  const sinceMs = parseInt(url.searchParams.get("since") ?? "", 10);
  const tail = Math.min(
    MAX_TAIL,
    parseInt(url.searchParams.get("tail") ?? `${DEFAULT_TAIL}`, 10) ||
      DEFAULT_TAIL
  );

  // Docker's `since` is seconds (Unix), not ms. If client gave us a
  // since-ms timestamp use it; otherwise default to the last
  // DEFAULT_SINCE_MS window.
  const sinceSec = Number.isFinite(sinceMs)
    ? Math.floor(sinceMs / 1000)
    : Math.floor((Date.now() - DEFAULT_SINCE_MS) / 1000);

  const dockerUrl =
    `/containers/${encodeURIComponent(containerRaw)}/logs?` +
    `stdout=1&stderr=1&tail=${tail}&since=${sinceSec}&timestamps=1`;

  let res: Response;
  try {
    res = await dockerFetch(dockerUrl);
  } catch (err) {
    return Response.json(
      {
        error: "docker_socket_unreachable",
        detail: (err as Error).message,
      },
      { status: 502 }
    );
  }
  if (res.status === 404) {
    return Response.json(
      { error: "container_not_found", container: containerRaw },
      { status: 404 }
    );
  }
  if (!res.ok) {
    const body = await res.text();
    return Response.json(
      { error: "docker_api_error", status: res.status, detail: body.slice(0, 500) },
      { status: 502 }
    );
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const lines = parseDockerLogStream(buf, true);
  // Filter again client-side — Docker's `since` is second-precision,
  // we want millisecond filtering for consistent dedup at the caller.
  const cutoff = Number.isFinite(sinceMs) ? sinceMs : 0;
  const filtered = cutoff > 0 ? lines.filter((l) => l.ts > cutoff) : lines;
  return Response.json({ container: containerRaw, lines: filtered });
}

function authOk(req: Request): boolean {
  if (!TOKEN) return true;
  const h = req.headers.get("authorization") ?? "";
  return h === `Bearer ${TOKEN}`;
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }
    if (!authOk(req)) {
      return new Response("unauthorized", { status: 401 });
    }
    if (url.pathname.startsWith("/logs/")) {
      return handleLogs(req);
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(
  `[docker-log-bridge] listening on :${server.port}, docker.sock=${DOCKER_SOCKET}, auth=${TOKEN ? "on" : "off"}`
);
