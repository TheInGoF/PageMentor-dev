// Smoke-Test: Backend starten, Kern-API durchlaufen, ohne KI-Dienste.
// Aufruf: cd backend && bun scripts/smoke.ts

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const BASE = "http://127.0.0.1:3000";
const PASSWORD = "smoke";
const dataDir = mkdtempSync(join(tmpdir(), "pm-smoke-"));

const server = Bun.spawn(["bun", "src/index.ts"], {
  env: {
    ...process.env,
    PM_PASSWORD: PASSWORD,
    PM_DATA_DIR: dataDir,
    MEILI_URL: "http://127.0.0.1:1",
    PM_DOCLING_URL: "http://127.0.0.1:1",
  },
  stdout: "pipe",
  stderr: "pipe",
});

let cookie = "";
let failures = 0;

function cleanup() {
  server.kill();
  if (!process.env.SMOKE_KEEP) rmSync(dataDir, { recursive: true, force: true });
  else console.log("Daten behalten in", dataDir);
}

async function waitForHealth() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {}
    await Bun.sleep(200);
  }
  throw new Error("Backend startet nicht");
}

async function call(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { cookie } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["content-type"] = "application/json";
  }
  const r = await fetch(BASE + path, init);
  const text = await r.text();
  const ok = r.status >= 200 && r.status < 300;
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FAIL"} ${method} ${path} → ${r.status}`);
  if (!ok) console.log("     " + text.slice(0, 300));
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Minimal gültiges PDF, eine leere Seite
const PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj
trailer<</Root 1 0 R>>
%%EOF`;

async function run() {
  await waitForHealth();

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  await call("GET", "/api/auth/check");

  const mod = await call("POST", "/api/modules", { name: "Smoke-Modul" });
  const moduleId = mod.id;

  const form = new FormData();
  form.append("file", new File([PDF], "smoke.pdf", { type: "application/pdf" }));
  form.append("module", moduleId ?? "");
  form.append("tags", "smoke,test");
  const doc = await call("POST", "/api/documents/upload", form);
  const docId = doc.id;

  await call("GET", "/api/documents");
  await call("GET", `/api/documents/${docId}`);
  await call("GET", `/api/documents/${docId}/pdf`);
  await call("GET", "/api/documents/tags/all");
  await call("PATCH", `/api/documents/${docId}`, { title: "Smoke umbenannt" });
  await call("GET", `/api/chapters/${docId}`);
  await call("GET", "/api/modules");
  await call("GET", `/api/modules/${moduleId}`);
  await call("GET", "/api/dashboard");

  const card = await call("POST", "/api/cards", {
    document_id: docId,
    question: "Was ist 2+2?",
    answer: "4",
  });
  await call("GET", `/api/cards/document/${docId}`);
  await call("GET", `/api/cards/stats/${docId}`);
  await call("GET", `/api/cards/due/${docId}`);
  await call("POST", `/api/cards/${card.id}/review`, { quality: 5 });
  await call("GET", `/api/cards/export/${docId}`);

  const exam = await call("POST", `/api/exam/start/${docId}`, { count: 1 });
  const sessionId = exam.id ?? exam.sessionId;
  await call("GET", `/api/exam/${sessionId}`);
  await call("POST", `/api/exam/${sessionId}/submit`, {
    answers: { [card.id]: { quality: 5 } },
  });
  await call("GET", `/api/exam/history/${docId}`);

  const chat = await call("POST", "/api/tutor/sessions", {});
  await call("GET", "/api/tutor/sessions");
  await call("GET", `/api/tutor/sessions/${chat.session.id}`);
  await call("DELETE", `/api/tutor/sessions/${chat.session.id}`);

  await call("GET", "/api/llm/config");
  await call("GET", "/api/voices/custom");
  await call("GET", "/api/voices/design");
  await call("GET", "/api/voices/presets/visibility");
  await call("GET", "/api/rag/status");
  await call("GET", "/api/summary/status");
  await call("GET", `/api/audio/chapter-status/${docId}`);
  await call("GET", `/api/audio/document/${docId}`);
  await call("GET", "/api/audio/voices");

  await call("POST", "/api/logs/client", { kind: "smoke", message: "Testfehler aus dem Smoke-Test", stack: "at smoke" });
  await call("GET", "/api/logs/days");
  const logs = await call("GET", "/api/logs?level=warn");
  if (!logs.lines?.some((l: { msg: string }) => l.msg.includes("Testfehler"))) {
    failures++;
    console.log("FAIL Frontend-Fehler fehlt im Log");
  }
  const diag = await call("POST", "/api/logs/diagnostics");
  const zip = await fetch(BASE + diag.url, { headers: { cookie } });
  const bytes = new Uint8Array(await zip.arrayBuffer());
  if (zip.status !== 200 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    failures++;
    console.log("FAIL Diagnosepaket ist kein ZIP");
  } else console.log(`OK   Diagnosepaket ${diag.name} (${bytes.length} Bytes)`);
  await call("DELETE", `/api/cards/${card.id}`);
  await call("DELETE", `/api/documents/${docId}`);
  await call("DELETE", `/api/modules/${moduleId}`);
}

try {
  await run();
} catch (err) {
  failures++;
  console.error("Abbruch:", err);
}

if (failures > 0) {
  console.log("\n--- Backend-Ausgabe ---");
  server.kill();
  console.log(await new Response(server.stdout).text());
  console.log(await new Response(server.stderr).text());
}
cleanup();
console.log(failures === 0 ? "\nSmoke-Test bestanden" : `\n${failures} Fehler`);
process.exit(failures === 0 ? 0 : 1);
