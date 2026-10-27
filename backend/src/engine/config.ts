// Feste Werte der Engine-Umgebung
import { join } from "path";
import { APP_DIR } from "../paths";

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
export const DEFAULT_LLM_MODEL = process.env.PM_DEFAULT_LLM_MODEL || "gemma4:e4b";

// Dienste mit Health-Adresse, von Windows aus gesehen
export const SERVICES = [
  { id: "arbiter", title: "GPU-Arbiter", url: `http://${ENGINE_HOST}:8790/health` },
  { id: "docling", title: "Docling (PDF)", url: `http://${ENGINE_HOST}:5001/health` },
  { id: "embeddings", title: "Embeddings", url: `http://${ENGINE_HOST}:8080/health` },
  { id: "search", title: "Suche", url: `http://${ENGINE_HOST}:7700/health` },
] as const;

export const MIN_FREE_GB_WARN = 30;
export const MIN_FREE_GB_ERROR = 10;
