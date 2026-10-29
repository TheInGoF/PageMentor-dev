// Reparaturen: WSL, Umgebung, Einrichtung, Docker, Pakete, Dienste, Modell
import { createHash } from "crypto";
import { createWriteStream, existsSync, mkdirSync, rmSync, statfsSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { APP_DIR, IS_COMPILED, IS_WINDOWS } from "../paths";
import { effective } from "../services/llmConfig";
import type { RepairId } from "./checks";
import {
  COMPOSE_IN_DISTRO,
  DEFAULT_LLM_MODEL,
  IMAGES_MARK_IN_DISTRO,
  imagesRevision,
  SCRIPTS_DIR,
  DISK_DIR,
  DISTRO,
  ENGINE_DIR,
  DOCLING_ARTIFACTS,
  DOCLING_CONTAINER,
  DOCLING_EXTRA_MODELS,
  doclingModelMark,
  ENGINE_HOST,
  ROOTFS_FILE,
  ROOTFS_SUMS_URL,
  ROOTFS_URL,
} from "./config";
import { failText, inDistro, logEngine, run, wsl } from "./exec";
import { extraServices, writeEngineEnv } from "./extraEngines";

export type Progress = (message: string, fraction?: number) => void;

// Skripte: in der Exe neben dem Programm, im Repo unter engine/
// Laufende Dienste; Kokoro ist die Standardstimme, die übrigen Stimmen startet der Arbiter bei Bedarf
const ALWAYS_ON = ["ollama", "docling", "pm-gpu-arbiter", "infinity", "meilisearch", "kokoro-tts"];

export class RepairError extends Error {}

async function enableWsl(progress: Progress): Promise<void> {
  progress("Bitte die Windows-Abfrage für Administratorrechte bestätigen …");
  const r = await run("powershell.exe", [
    "-NoProfile",
    "-Command",
    "$p = Start-Process wsl.exe -ArgumentList '--install','--no-distribution' -Verb RunAs -Wait -PassThru; exit $p.ExitCode",
  ]);
  if (r.code !== 0) throw new RepairError(`WSL konnte nicht eingeschaltet werden: ${failText(r)}`);
  progress("WSL eingeschaltet. Falls Windows danach fragt: bitte neu starten.", 1);
}

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = Bun.file(file).stream();
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

async function downloadRootfs(progress: Progress): Promise<void> {
  mkdirSync(dirname(ROOTFS_FILE), { recursive: true });
  const sums = await (await fetch(ROOTFS_SUMS_URL)).text();
  const expected = sums.split("\n").find((l) => l.endsWith(ROOTFS_URL.split("/").pop()!))?.split(/\s+/)[0];
  if (!expected) throw new RepairError("Prüfsumme für Ubuntu nicht gefunden");
  if (existsSync(ROOTFS_FILE) && (await sha256(ROOTFS_FILE)) === expected) {
    progress("Ubuntu-Basis schon geladen");
    return;
  }
  const res = await fetch(ROOTFS_URL);
  if (!res.ok || !res.body) throw new RepairError(`Download fehlgeschlagen: HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length") ?? 0);
  const out = createWriteStream(ROOTFS_FILE);
  let done = 0;
  let lastReport = 0;
  for await (const chunk of res.body) {
    out.write(chunk);
    done += chunk.length;
    if (Date.now() - lastReport > 1000) {
      lastReport = Date.now();
      progress(`Lade Ubuntu: ${(done / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`, total ? done / total : undefined);
    }
  }
  await new Promise<void>((resolve, reject) => out.end((err: unknown) => (err ? reject(err) : resolve())));
  if ((await sha256(ROOTFS_FILE)) !== expected) {
    rmSync(ROOTFS_FILE, { force: true });
    throw new RepairError("Ubuntu-Download beschädigt (Prüfsumme falsch), bitte erneut versuchen");
  }
}

// Große Downloads nur mit genug Platz: eine volle Platte beschädigte die Engine-Festplatte (WSL-Fehler 5)
const MIN_FREE_GB_DOWNLOAD = 15;
function requireSpace(what: string): void {
  try {
    const s = statfsSync(IS_WINDOWS ? ENGINE_DIR.slice(0, 3) : "/");
    const free = (s.bavail * s.bsize) / 1024 ** 3;
    if (free < MIN_FREE_GB_DOWNLOAD)
      throw new RepairError(`Zu wenig Speicher für ${what}: ${free.toFixed(0)} GB frei, mindestens ${MIN_FREE_GB_DOWNLOAD} GB nötig. Bitte Platz schaffen und erneut versuchen.`);
  } catch (err) {
    if (err instanceof RepairError) throw err;
  }
}

// Engine-Festplatte „sparse“: frei gewordener Platz geht an Windows zurück, statt dass die Datei nur wächst.
// Geht nur bei gestoppter Umgebung; gemerkt in engine\sparse.done
const SPARSE_MARK = join(ENGINE_DIR, "sparse.done");
export async function ensureSparse(): Promise<void> {
  if (!IS_WINDOWS || existsSync(SPARSE_MARK) || !existsSync(join(DISK_DIR, "ext4.vhdx"))) return;
  await wsl(["--terminate", DISTRO], { timeoutMs: 60_000, quiet: true });
  const r = await wsl(["--manage", DISTRO, "--set-sparse", "true"], { timeoutMs: 120_000, quiet: true });
  if (r.code === 0) {
    mkdirSync(ENGINE_DIR, { recursive: true });
    writeFileSync(SPARSE_MARK, new Date().toISOString());
    logEngine("info", "Engine-Festplatte gibt freien Platz jetzt an Windows zurück (sparse)");
  } else {
    // Neuere WSL-Versionen erlauben sparse nur noch mit --allow-unsafe: dann lassen wir es,
    // merken uns das und versuchen es nicht bei jedem Start erneut; aufgeräumt wird trotzdem
    mkdirSync(ENGINE_DIR, { recursive: true });
    writeFileSync(SPARSE_MARK, `skipped ${new Date().toISOString()}`);
    logEngine("info", `Engine-Festplatte bleibt fest groß, WSL erlaubt sparse hier nicht: ${failText(r)}`);
  }
}

async function importDistro(progress: Progress): Promise<void> {
  requireSpace("die Engine");
  await downloadRootfs(progress);
  progress("Richte die Engine-Umgebung ein …");
  mkdirSync(DISK_DIR, { recursive: true });
  const r = await wsl(["--import", DISTRO, DISK_DIR, ROOTFS_FILE, "--version", "2"], { timeoutMs: 15 * 60_000 });
  if (r.code !== 0) throw new RepairError(`Import fehlgeschlagen: ${failText(r)}`);
  await ensureSparse();
  await provision(progress);
}

// Windows-Pfad in der Umgebung, z. B. C:\x → /mnt/c/x
async function linuxPath(winPath: string): Promise<string> {
  const r = await inDistro(`wslpath -a '${winPath.replace(/'/g, "'\\''")}'`, { quiet: true, timeoutMs: 30_000 });
  if (r.code !== 0) throw new RepairError(`Pfad nicht umsetzbar: ${winPath}`);
  return r.stdout.trim();
}

async function provision(progress: Progress, attempt = 1): Promise<void> {
  const dir = await linuxPath(SCRIPTS_DIR);
  progress("Installiere Docker und GPU-Unterstützung (einige Minuten) …");
  const r = await inDistro(`PM_COMPOSE_SRC='${dir}/compose.yaml' bash '${dir}/provision.sh'`, {
    timeoutMs: 45 * 60_000,
    onLine: (l) => l.startsWith("[provision]") && progress(l.replace("[provision] ", "")),
  });
  if (r.code === 10 && attempt === 1) {
    progress("Starte die Engine-Umgebung neu …");
    await wsl(["--terminate", DISTRO], { timeoutMs: 60_000 });
    return provision(progress, 2);
  }
  if (r.code !== 0) throw new RepairError(`Einrichtung fehlgeschlagen: ${failText(r)}`);
}

async function startDocker(progress: Progress): Promise<void> {
  progress("Starte Docker …");
  const r = await inDistro("systemctl start docker && systemctl is-active docker", { timeoutMs: 120_000 });
  if (r.code !== 0) await provision(progress);
}

// Lesbarer Name eines Pakets: ghcr.io/theingof/pm-kokoro-tts:latest → pm-kokoro-tts
const imageName = (img: string) => img.split("/").pop()!.split(":")[0];

// Pakete einzeln laden, mit lesbarem Fortschritt statt der Docker-Ausgabe. Hat sich der Fingerabdruck nicht
// geändert (z. B. nur eine Stimme eingeschaltet), nur die fehlenden
// Eigener Docker-Konfigordner: eine Docker-Desktop-Einstellung (credsStore "desktop") im Standardordner
// ruft docker-credential-desktop.exe auf, das in der Engine-Umgebung nicht läuft; die Pakete sind öffentlich
const DOCKER_CONFIG_DIR = "/opt/pagementor/docker";
const DOCKER = `DOCKER_CONFIG=${DOCKER_CONFIG_DIR} docker`;

async function pullImages(progress: Progress): Promise<void> {
  // Profile der zusätzlichen Stimmen zuerst, sonst fehlen ihre Pakete
  await writeEngineEnv();
  await syncCompose();
  const rev = imagesRevision();
  // Merker bis v1.21.3 hieß .images-version: Stände sind frisch, nur Fehlendes laden statt alles erneut
  const mark = (await inDistro(`cat ${IMAGES_MARK_IN_DISTRO} 2>/dev/null || (test -f /opt/pagementor/.images-version && echo '${rev}')`, { timeoutMs: 30_000, quiet: true })).stdout.trim();
  const compose = `${DOCKER} compose -f ${COMPOSE_IN_DISTRO}`;
  const list = await inDistro(
    mark === rev
      ? `for i in $(${compose} config --images); do docker image inspect "$i" >/dev/null 2>&1 || echo "$i"; done`
      : `${compose} config --images`,
    { timeoutMs: 60_000, quiet: true }
  );
  if (list.code !== 0) throw new RepairError(`Paketliste nicht lesbar: ${failText(list)}`);
  const images = [...new Set(list.stdout.split("\n").map((s) => s.trim()).filter(Boolean))];
  if (images.length) requireSpace("die Programmpakete");
  for (const [i, img] of images.entries()) {
    progress(`Paket ${i + 1} von ${images.length}: ${imageName(img)}`, i / images.length);
    const r = await inDistro(`${DOCKER} pull -q ${img}`, { timeoutMs: 6 * 3600_000, quiet: true });
    if (r.code !== 0) {
      // Private Pakete auf ghcr.io: Docker darf sie ohne Anmeldung nicht laden
      if (/unauthorized|denied/i.test(`${r.stdout}\n${r.stderr}`))
        throw new RepairError(`Download verweigert für ${imageName(img)}: Das Paket auf ghcr.io ist nicht öffentlich. Bitte auf GitHub unter Packages auf „Public“ stellen und erneut versuchen.`);
      throw new RepairError(`Download von ${imageName(img)} fehlgeschlagen: ${failText(r)}`);
    }
  }
  progress("Starte Dienste …", 1);
  await startServices(progress);
  await inDistro(`echo '${rev}' > ${IMAGES_MARK_IN_DISTRO} && rm -f /opt/pagementor/.images-version`, { timeoutMs: 30_000, quiet: true });
  await pruneImages(progress);
}

// Alte Paketstände wegräumen: alles, was kein Container mehr nutzt (alte Versionen, umbenannte Pakete,
// abgeschaltete Engines). Erst nach dem Start der Dienste, sonst wären neue Stände noch unbenutzt
async function pruneImages(progress: Progress): Promise<void> {
  progress("Räume alte Paketstände auf …");
  const r = await inDistro("docker image prune -a -f 2>&1 | tail -n 1", { timeoutMs: 15 * 60_000, quiet: true });
  if (r.code === 0 && r.stdout.trim()) logEngine("info", `Alte Pakete entfernt: ${r.stdout.trim()}`);
  // Freie Blöcke melden, damit die sparse Festplatte unter Windows schrumpft
  await inDistro("fstrim -a 2>/dev/null || true", { timeoutMs: 10 * 60_000, quiet: true });
}

// compose.yaml der installierten App in die Umgebung übernehmen, damit Korrekturen auch ohne Neueinrichtung ankommen
async function syncCompose(): Promise<void> {
  const src = `${await linuxPath(SCRIPTS_DIR)}/compose.yaml`;
  const r = await inDistro(
    `mkdir -p ${DOCKER_CONFIG_DIR} && (test -f ${DOCKER_CONFIG_DIR}/config.json || echo '{}' > ${DOCKER_CONFIG_DIR}/config.json) && ` +
      `(cmp -s '${src}' ${COMPOSE_IN_DISTRO} || install -m 644 '${src}' ${COMPOSE_IN_DISTRO})`,
    { timeoutMs: 60_000, quiet: true }
  );
  if (r.code !== 0) throw new RepairError(`compose.yaml nicht übernommen: ${failText(r)}`);
}

async function startServices(progress: Progress): Promise<void> {
  progress("Starte Dienste …");
  await syncCompose();
  await writeEngineEnv();
  const compose = `${DOCKER} compose -f ${COMPOSE_IN_DISTRO}`;
  const extra = extraServices();
  // Kerndienste zuerst und für sich: eine fehlende Zusatzstimme darf sie nicht blockieren
  const core = await inDistro(`${compose} up -d --remove-orphans ${ALWAYS_ON.join(" ")}`, {
    timeoutMs: 15 * 60_000,
    onLine: (l) => progress(l.trim().slice(0, 160)),
  });
  if (core.code !== 0) throw new RepairError(`Dienste starten fehlgeschlagen: ${failText(core)}`);
  // Abgeschaltete Zusatzstimmen entfernen; scheitert ohne Folgen, wenn es sie nicht gibt
  if (extra.off.length) await inDistro(`docker rm -f ${extra.off.join(" ")} >/dev/null 2>&1 || true`, { timeoutMs: 120_000, quiet: true });
  const cmds = [extra.up.length ? `${compose} up -d ${extra.up.join(" ")}` : "", extra.create.length ? `${compose} up --no-start ${extra.create.join(" ")}` : ""].filter(Boolean);
  if (!cmds.length) return;
  const voices = await inDistro(cmds.join(" && "), { timeoutMs: 15 * 60_000, onLine: (l) => progress(l.trim().slice(0, 160)) });
  if (voices.code !== 0) {
    const denied = /unauthorized|denied/i.test(`${voices.stdout}\n${voices.stderr}`);
    throw new RepairError(
      denied
        ? "Kerndienste laufen. Zusätzliche Stimmen fehlen: Ihre Pakete auf ghcr.io sind nicht öffentlich (pm-qwen-tts-dev, pm-f5-tts, pm-tada-tts auf „Public“ stellen)."
        : `Kerndienste laufen. Zusätzliche Stimmen nicht gestartet: ${failText(voices)}`
    );
  }
}

// Zusatzmodelle in den Docling-Cache (Docker-Volume, übersteht Updates); schon vorhandene Dateien werden übersprungen
async function doclingModels(progress: Progress): Promise<void> {
  requireSpace("die Docling-Modelle");
  progress("Lade Docling-Modelle (einmalig ca. 5 GB) …");
  const ids = DOCLING_EXTRA_MODELS.map((m) => m.id).join(" ");
  const marks = DOCLING_EXTRA_MODELS.map((m) => doclingModelMark(m.id)).join(" ");
  const r = await inDistro(
    `docker exec -u 0 ${DOCLING_CONTAINER} sh -c 'docling-tools models download -o ${DOCLING_ARTIFACTS} ${ids} && touch ${marks} && chown -R 1001:0 ${DOCLING_ARTIFACTS}'`,
    { timeoutMs: 3 * 3600_000, onLine: (l) => progress(l.trim().slice(0, 160)) }
  );
  if (r.code !== 0) throw new RepairError(`Docling-Modelle nicht geladen: ${failText(r)}`);
  progress("Starte Docling neu …");
  const restart = await inDistro(`docker restart ${DOCLING_CONTAINER}`, { timeoutMs: 180_000, quiet: true });
  if (restart.code !== 0) throw new RepairError(`Docling startet nicht neu: ${failText(restart)}`);
}

async function pullModel(progress: Progress): Promise<void> {
  requireSpace("das Sprachmodell");
  const name = effective("ollamaModel", "PM_OLLAMA_MODEL") || DEFAULT_LLM_MODEL;
  progress(`Lade Sprachmodell ${name} …`);
  const res = await fetch(`http://${ENGINE_HOST}:8790/api/pull`, {
    method: "POST",
    body: JSON.stringify({ name, stream: true }),
  });
  if (!res.ok || !res.body) throw new RepairError(`Modell-Download fehlgeschlagen: HTTP ${res.status}`);
  let buf = "";
  for await (const chunk of res.body) {
    buf += new TextDecoder().decode(chunk);
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const ev = JSON.parse(line) as { status?: string; completed?: number; total?: number; error?: string };
      if (ev.error) throw new RepairError(`Modell-Download: ${ev.error}`);
      const frac = ev.total ? (ev.completed ?? 0) / ev.total : undefined;
      progress(`${name}: ${ev.status ?? ""}${frac !== undefined ? ` ${(frac * 100).toFixed(0)} %` : ""}`, frac);
    }
  }
}

const REPAIRS: Record<RepairId, { title: string; fn: (p: Progress) => Promise<void> }> = {
  "enable-wsl": { title: "WSL einschalten", fn: enableWsl },
  "import-distro": { title: "Engine-Umgebung einrichten", fn: importDistro },
  provision: { title: "Docker und GPU einrichten", fn: (p) => provision(p) },
  "start-docker": { title: "Docker starten", fn: startDocker },
  "pull-images": { title: "Programmpakete laden", fn: pullImages },
  "start-services": { title: "Dienste starten", fn: startServices },
  "pull-model": { title: "Sprachmodell laden", fn: pullModel },
  "docling-models": { title: "Docling-Modelle laden", fn: doclingModels },
  "apply-tts-engines": { title: "Stimmen-Engines übernehmen", fn: pullImages },
};

export function repairTitle(id: RepairId): string {
  return REPAIRS[id]?.title ?? id;
}

export async function runRepairAction(id: RepairId, progress: Progress): Promise<void> {
  const r = REPAIRS[id];
  if (!r) throw new RepairError(`Unbekannte Reparatur: ${id}`);
  logEngine("info", `Reparatur gestartet: ${r.title}`);
  await r.fn(progress);
  logEngine("info", `Reparatur fertig: ${r.title}`);
}

// Für den Selbsttest: Skripte vorhanden?
export function scriptsPresent(): boolean {
  return existsSync(join(SCRIPTS_DIR, "provision.sh")) && existsSync(join(SCRIPTS_DIR, "compose.yaml"));
}
