// HTTP-Client für den TTS-Sidecar
import * as http from "node:http";
import * as https from "node:https";
import { URL } from "node:url";
import { emitLog } from "../../../log/logger";
import { HttpError } from "../../../log/errors";

// Lange TTS-Anfrage über node:http
// Bun-fetch und undici brechen still nach ~5 min ab, egal welcher Timeout
// Zusätzlich TCP-Keepalive alle 30 s gegen NAT- und Docker-Abbrüche
let _ttsFetchLogged = false;
async function ttsFetchRaw(
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    timeoutMs: number;
    // Abbruch zerstört die laufende Anfrage
    signal?: AbortSignal;
  }
): Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}> {
  if (!_ttsFetchLogged) {
    console.log(
      `[qwen-tts] using node:http + TCP keepalive(30s) for sidecar calls ` +
        `(timeoutMs=${init.timeoutMs})`
    );
    _ttsFetchLogged = true;
  }

  if (init.signal?.aborted) {
    throw new Error("TTS request aborted before start");
  }

  const u = new URL(url);
  const bodyBuf = Buffer.from(init.body, "utf-8");
  const headers: Record<string, string> = {
    ...init.headers,
    "Content-Length": bodyBuf.length.toString(),
  };

  // Transport nach Schema, sonst https im Klartext auf Port 80
  const isHttps = u.protocol === "https:";
  const transport = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname: u.hostname,
        port: u.port ? Number(u.port) : isHttps ? 443 : 80,
        path: u.pathname + (u.search || ""),
        method: init.method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          detachAbort();
          const buf = Buffer.concat(chunks);
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            statusText: res.statusMessage ?? String(status),
            text: async () => buf.toString("utf-8"),
            arrayBuffer: async () =>
              buf.buffer.slice(
                buf.byteOffset,
                buf.byteOffset + buf.byteLength
              ) as ArrayBuffer,
          });
        });
        res.on("error", (err: Error) => {
          detachAbort();
          reject(err);
        });
      }
    );

    // Abbruch → req.destroy()
    // Listener wieder lösen: ein Controller für Hunderte Chunks
    const onAbort = () => {
      req.destroy(new Error("TTS request aborted"));
    };
    const detachAbort = () => {
      init.signal?.removeEventListener("abort", onAbort);
    };
    if (init.signal) {
      init.signal.addEventListener("abort", onAbort, { once: true });
    }

    // Leerlauf-Timeout, dank Keepalive nur bei echter Stille
    req.setTimeout(init.timeoutMs, () => {
      req.destroy(
        new Error(
          `TTS request idle for ${init.timeoutMs}ms — sidecar didn't respond`
        )
      );
    });

    // TCP-Keepalive, sobald der Socket steht
    req.on("socket", (sock) => {
      sock.setKeepAlive(true, 30_000);
      sock.setNoDelay(true);
    });

    req.on("error", (err: Error) => {
      detachAbort();
      reject(err);
    });
    req.write(bodyBuf);
    req.end();
  });
}

// Wie ttsFetchRaw, plus Log: Ziel, Dauer, Status, Antworttext bei Fehler
export async function ttsFetch(
  url: string,
  init: Parameters<typeof ttsFetchRaw>[1]
): ReturnType<typeof ttsFetchRaw> {
  const target = url.split("?")[0];
  const t0 = performance.now();
  try {
    const res = await ttsFetchRaw(url, init);
    const durationMs = Math.round(performance.now() - t0);
    if (res.ok) {
      emitLog("info", "tts", `${init.method} ${target} → ${res.status} (${durationMs} ms)`, { ctx: { status: res.status, durationMs } });
    } else {
      const body = await res.text().catch(() => "");
      emitLog("warn", "tts", `${init.method} ${target} → ${res.status} (${durationMs} ms)`, {
        err: new HttpError(`TTS-Sidecar HTTP ${res.status}`, res.status, target, body.slice(0, 2000)),
        ctx: { status: res.status, durationMs },
      });
      return { ...res, text: async () => body };
    }
    return res;
  } catch (err) {
    const durationMs = Math.round(performance.now() - t0);
    emitLog(init.signal?.aborted ? "info" : "warn", "tts", `${init.method} ${target} ${init.signal?.aborted ? "abgebrochen" : "fehlgeschlagen"} nach ${durationMs} ms`, { err, ctx: { durationMs } });
    throw err;
  }
}
