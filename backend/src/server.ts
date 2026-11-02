// HTTP-Server mit wechselbarer Bindung: nur lokal (127.0.0.1) oder fürs Heimnetz (0.0.0.0)
import { emitLog } from "./log/logger";

type AppServer = ReturnType<typeof Bun.serve>;
type Fetch = (req: Request, server: AppServer) => Response | Promise<Response>;

let server: AppServer | null = null;
let handler: Fetch | null = null;
let port = 0;

export const LOCAL_HOST = "127.0.0.1";
export const LAN_HOST = "0.0.0.0";

function serve(host: string): AppServer {
  return Bun.serve({
    port,
    hostname: host,
    fetch: handler!,
    // Bun beendet Anfragen sonst nach 10 s: zu kurz für Audio-Bereiche, LLM-Ströme und M4B-Umbauten
    idleTimeout: 0,
    // Videos für den Stimm-Extraktor können groß sein (Standard wären 128 MB)
    maxRequestBodySize: 8 * 1024 ** 3,
  });
}

export function startServer(fetch: Fetch, host: string, p: number): AppServer {
  handler = fetch;
  port = p;
  server = serve(host);
  return server;
}

export function serverHost(): string {
  return server?.hostname ?? LOCAL_HOST;
}

// Bindung wechseln: alten Server schließen, neu lauschen; Verbindungen der Oberfläche bauen sich neu auf
export async function rebindServer(host: string): Promise<void> {
  if (!server || server.hostname === host) return;
  const old = server.hostname ?? LOCAL_HOST;
  await server.stop(true);
  for (let attempt = 0; ; attempt++) {
    try {
      server = serve(host);
      emitLog("info", "startup", `Server lauscht jetzt auf ${host}:${port}`);
      return;
    } catch (err) {
      if (attempt < 5) {
        await Bun.sleep(300);
        continue;
      }
      emitLog("error", "startup", `Bindung an ${host}:${port} fehlgeschlagen, zurück zu ${old}`, { err });
      server = serve(old);
      throw err;
    }
  }
}
