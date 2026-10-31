// Feste Werte der Engine-Umgebung
import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { APP_DIR, IS_COMPILED } from "../paths";

export const DISTRO = process.env.PM_ENGINE_DISTRO || "PageMentor-Engine";
export const ENGINE_HOST = process.env.PM_ENGINE_HOST || "localhost";

// Im Programmordner: Skripte, Compose-Datei, WSL-Disk
export const ENGINE_DIR = process.env.PM_ENGINE_DIR || join(APP_DIR, "engine");
export const DISK_DIR = join(ENGINE_DIR, "disk");
export const ROOTFS_FILE = join(ENGINE_DIR, "ubuntu-24.04-wsl.rootfs.tar.gz");

// Offizielle Ubuntu-Basis mit Prüfsumme
export const ROOTFS_URL =
  "https://cloud-images.ubuntu.com/wsl/releases/24.04/current/ubuntu-noble-wsl-amd64-24.04lts.rootfs.tar.gz";
export const ROOTFS_SUMS_URL = "https://cloud-images.ubuntu.com/wsl/releases/24.04/current/SHA256SUMS";

export const COMPOSE_IN_DISTRO = "/opt/pagementor/compose.yaml";
// Engine-Skripte der App (compose.yaml, provision.sh), im Paket neben der Exe
export const SCRIPTS_DIR = IS_COMPILED ? join(APP_DIR, "engine") : join(APP_DIR, "..", "engine");

// Fingerabdruck der Engine-Pakete, mit dem sie zuletzt geladen wurden; nur wenn er sich ändert, holt die Engine
// neue Stände (nicht bei jeder App-Version: Ollama auf latest kostete sonst jedes Mal ~4 GB)
export const IMAGES_MARK_IN_DISTRO = "/opt/pagementor/.images-rev";

// Der Build schreibt images.rev aus compose.yaml und den Quellordnern der Pakete; sonst zählt compose.yaml
export function imagesRevision(): string {
  const rev = join(SCRIPTS_DIR, "images.rev");
  if (existsSync(rev)) return readFileSync(rev, "utf8").trim();
  const compose = join(SCRIPTS_DIR, "compose.yaml");
  return existsSync(compose) ? createHash("sha1").update(readFileSync(compose)).digest("hex").slice(0, 12) : "unbekannt";
}
export const DEFAULT_LLM_MODEL = process.env.PM_DEFAULT_LLM_MODEL || "gemma4:e4b";

// Größere Sprachmodelle zum Dazuladen, für den Tutor. Kontext so gewählt, dass Modell, Kontext und der
// dauerhaft geladene Embedding-Dienst (~2 GB) unter den 24 GB einer RTX 3090 bleiben; voll ausgelastet
// lagert Ollama aus und wird langsam
// hits und turns: wie viele Quellen und Gesprächsrunden in diesen Kontext passen
export interface LlmBudget {
  ctx: number;
  hits: number;
  turns: number;
}
export const EXTRA_LLMS: Record<string, { title: string; sizeGb: number } & LlmBudget> = {
  "gemma4:26b": { title: "Gemma 4 26B", sizeGb: 17, ctx: 24576, hits: 20, turns: 5 },
  "qwen3.6:27b": { title: "Qwen 3.6 27B", sizeGb: 18, ctx: 16384, hits: 14, turns: 4 },
};
// Das kleine Modell braucht kaum Speicher: im Tutor mit großem Gedächtnis (mehr Quellen, längerer Verlauf)
export const DEFAULT_LLM_BUDGET: LlmBudget = { ctx: 65536, hits: 30, turns: 12 };

// Dienste mit Health-Adresse, von Windows aus gesehen
export const SERVICES = [
  { id: "arbiter", title: "GPU-Arbiter", url: `http://${ENGINE_HOST}:8790/health` },
  { id: "docling", title: "Docling (PDF)", url: `http://${ENGINE_HOST}:5001/health` },
  { id: "embeddings", title: "Embeddings", url: `http://${ENGINE_HOST}:8080/health` },
  { id: "search", title: "Suche", url: `http://${ENGINE_HOST}:7700/health` },
] as const;

// Zusatzmodelle für Docling in höchster Stufe (Bildbeschreibung, Diagramme, Formeln).
// Das Image sucht Modelle nur im Modellordner und lädt nicht selbst nach; die App lädt sie einmalig in den Cache
export const DOCLING_CONTAINER = "pm-docling";
export const DOCLING_ARTIFACTS = "/opt/app-root/src/.cache/docling/models";
export const DOCLING_EXTRA_MODELS = [
  { id: "smolvlm", title: "Bildbeschreibung" },
  { id: "granite_chart_extraction", title: "Diagramme" },
  { id: "code_formula", title: "Formeln und Code" },
] as const;
// Merker je Modell, erst nach vollständigem Download gesetzt
export const doclingModelMark = (id: string) => `${DOCLING_ARTIFACTS}/.pm-${id}`;

export const MIN_FREE_GB_WARN = 30;
export const MIN_FREE_GB_ERROR = 10;
