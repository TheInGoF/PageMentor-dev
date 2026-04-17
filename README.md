# PageMentor

A self-hosted study companion. Upload your lecture PDFs and get **audiobooks,
flashcards, exam-trainer sessions and summaries** — locally, on your own
hardware, with no cloud account or API credit attached.

> **Note:** This is a personal hobby project for data-obsessed self-hosters.
> It is not intended for commercial use and comes with no warranties or
> support guarantees.

## Architecture

```text
PDF upload                                              Browser (React 19 + Vite)
   │                                                        ▲
   ▼                                                        │ /api
SQLite ◀───── Bun + Hono backend ────────────────────────── ┘
   │             │
   │             ├─── pdf-parse  → boilerplate stripping → chapter detection
   │             │
   │             ├─── Microsoft Neural TTS (Edge Read-Aloud, via msedge-tts)
   │             │      └── SSML → ffmpeg loudnorm → MP3 per chapter → M4B
   │             │
   │             ├─── Meilisearch  (full-text over titles, chapters, OCR text)
   │             │
   │             └─── Ollama (optional) → summaries + AI flashcards
   │
   └─── data/
         uploads/        original PDFs
         audio/          chapter MP3s, book.m4b
         pagementor.db   SQLite (documents, chapters, cards, progress, …)
```

## Features

- **Library** — card grid with type/tag filters, pipeline-dot dashboard per
  document (text → chapters → audio → cards → summary), live SSE status
- **PDF viewer** — continuous scroll, zoom, page jump, text-selection → card
- **Chapter detection** — heading heuristic + fallback page slicing, with
  in-line editor (rename, merge, delete)
- **Audio cleanup** — watermarks, running heads, figure and table captions
  and inline references are stripped before TTS so the audiobook does not
  read out nonsense
- **Audiobook** — Microsoft Neural voices (Seraphina, Florian, Ava, Andrew,
  …) with SSML pauses, EBU R128 loudness normalisation, MP3 per chapter
  and a complete M4B with chapter markers
- **Send to Apple** — M4B download for Apple Books, private RSS feed for
  Apple Podcasts / Overcast / Pocket Casts (token derived from password)
- **Flashcards** — task extraction from chapter text, AI generator via
  local Ollama, SM-2 spaced repetition with hints, CSV export/import
  (Anki-compatible)
- **Exam trainer** — timed sessions with self-assessment and score history
  (sparkline chart)
- **Summaries** — Ollama-powered, three detail levels per chapter,
  streaming output
- **Full-text search** — Meilisearch over documents and chapters with
  in-place highlights
- **i18n** — English and German UI, auto-detects the browser language and
  remembers the override in settings

## Quickstart (Docker)

```bash
cp .env.example .env                # set PM_PASSWORD
docker compose up -d                # backend + Meilisearch
# optional, for summaries and AI cards:
docker compose --profile ai up -d   # adds Ollama

open http://localhost:3100
```

## Deployment on Synology / Portainer

The repo ships with a **second compose file** that uses bind mounts
under `/volume1/docker/pagementor/…` instead of Docker-managed named
volumes. That way your uploads, SQLite database and generated audio
survive container rebuilds and are visible through File Station.

### 1 — Prepare the folders (one-off)

SSH into the NAS or use File Station and create:

```bash
mkdir -p /volume1/docker/pagementor/data
mkdir -p /volume1/docker/pagementor/meili
mkdir -p /volume1/docker/pagementor/ollama    # optional, only if you enable the AI profile
```

### 2 — Portainer Stack

1. **Stacks → Add stack → Web editor**
2. **Name:** `pagementor`
3. Paste the contents of [`docker-compose.yml`](docker-compose.yml) — it ships pre-configured with `/volume1/docker/pagementor/{data,meili,ollama}` bind mounts for Synology.
4. **Environment variables → Advanced mode** — paste and tweak:

   ```env
   PM_PORT=3100
   PM_PASSWORD=change-me-to-something-long
   MEILI_MASTER_KEY=change-me-to-a-long-random-key
   PM_OLLAMA_URL=http://ollama:11434
   PM_OLLAMA_MODEL=llama3.1:8b
   ```

5. **Deploy the stack.**

The image is pulled from `ghcr.io/lordvonbaum/pagementor:latest`. Since
the repo is private, you'll need a Personal Access Token with
`read:packages` on your GitHub account:

- Go to GitHub → **Settings → Developer settings → Personal access tokens (classic)**
- Generate a token with scope `read:packages`
- In Portainer: **Registries → Add registry → Custom → `ghcr.io`**,
  username = your GitHub handle, password = the token

After the first successful deploy, open <http://NAS-IP:3100>, log in
with the `PM_PASSWORD` you set, and upload a PDF.

### 3 — Updating

When a new tag or push lands on `main`, GitHub Actions builds a new
image. In Portainer, open the stack and click **Update** (with "Pull
the latest images" enabled). All your data lives on the bind-mounted
folders and stays intact.

### 4 — Enabling Ollama on the NAS

Ollama needs some horsepower; a Synology is borderline for small models
(`llama3.2:3b` or `qwen2.5:3b` are realistic). To enable it, keep the
`ollama` service in the stack (it's already defined but tied to the
`ai` profile). In Portainer, the profile gate is ignored — the service
will start as long as it's in the YAML. Pull a model once it's up:

```bash
docker exec -it pm-ollama ollama pull llama3.2:3b
```

Then set `PM_OLLAMA_MODEL=llama3.2:3b` in the stack env and redeploy.

## Local development

```bash
# prerequisites
brew install bun ffmpeg

npm run install:all                 # backend (bun) + frontend (npm)
PM_PASSWORD=devpass npm run dev     # backend :3000, frontend :5173
```

Vite proxies `/api` to `:3000`, so the app opens at
<http://localhost:5173>.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PM_PASSWORD` | `changeme` | Login password (required) |
| `PM_PORT` | `3100` | Host port for the container |
| `PM_DATA_DIR` | `./data` | Uploads + SQLite + audio files |
| `MEILI_URL` | `http://meilisearch:7700` | Meilisearch endpoint |
| `MEILI_MASTER_KEY` | `pm-dev-key` | Meilisearch API key |
| `PM_OLLAMA_URL_PC` | — | Ollama on your workstation (NVIDIA, 1st choice) |
| `PM_OLLAMA_URL_MAC` | — | Ollama on a Mac (Apple Silicon, 2nd choice) |
| `PM_OLLAMA_URL` | — | Generic Ollama fallback (NAS, same-stack …) |
| `PM_OLLAMA_MODEL` | `llama3.1:8b` | Default Ollama model |
| `PM_ANTHROPIC_API_KEY` | — | Paid Claude fallback if no Ollama responds |
| `PM_ANTHROPIC_MODEL` | `claude-haiku-4-5-20251001` | Default Claude model |
| `PM_OPENAI_API_KEY` | — | Paid OpenAI fallback (after Claude) |
| `PM_OPENAI_MODEL` | `gpt-4o-mini` | Default OpenAI model |
| `PM_GOOGLE_API_KEY` | — | Google Gemini fallback (after OpenAI) |
| `PM_GOOGLE_MODEL` | `gemini-2.0-flash` | Default Gemini model |

Meilisearch is optional (full-text search disables itself if missing).
The **LLM chain** tries PC Ollama → Mac Ollama → generic Ollama →
Claude → OpenAI → Gemini → none — the first reachable wins. All of these can be changed
at runtime from the Settings modal; the override lives in
`$PM_DATA_DIR/llm-config.json` and survives redeploys. If nothing
responds, the Summary and AI-Card tabs show a "not configured" hint
and the rest of the app keeps working.

## Stack

- **Backend:** Bun + Hono + better-sqlite3
- **Frontend:** Vite + React 19 + Tailwind (night theme, red accents)
- **TTS:** Microsoft Azure Neural voices via
  [msedge-tts](https://www.npmjs.com/package/msedge-tts)
- **Search:** Meilisearch v1.12
- **LLM:** Ollama (optional, self-hosted)
- **Audio:** FFmpeg (loudnorm + M4B chapters, invoked as subprocess)

## Project structure

```text
backend/src/
  index.ts              # Hono app, routing, Meilisearch bootstrap
  auth.ts               # Cookie-based password auth
  db.ts                 # SQLite schema
  lib/i18n.ts           # Accept-Language → error dictionaries
  routes/               # documents, chapters, audio, cards, exam,
                        # search, summaries, feed
  services/             # pipeline, cleanup, audiobook, events,
                        # cards-extract, SM-2, search, ollama
  tts/                  # voices, segmenter, SSML, synth, ffmpeg

frontend/src/
  App.tsx               # router + auth gate
  components/           # Library, LearningMenu, PdfViewer,
                        # Audiobook, Cards, CardReview, ExamTrainer,
                        # Summaries, SearchOverlay, SettingsModal,
                        # PodcastShareModal, ShortcutsOverlay,
                        # ErrorBoundary
  lib/api.ts            # typed API client
  lib/i18n.ts           # useLocale hook + EN/DE dictionaries
  lib/settings.ts       # localStorage settings store
```

## Inspiration

Huge thanks to the authors of the open-source tools this project stands on
top of — in particular **Meilisearch**, **Ollama**, **react-pdf**,
**pdfjs-dist** and **FFmpeg**. Microsoft Neural Voices are of course a
Microsoft product; PageMentor only calls the same public Edge Read-Aloud
endpoint a browser would, and routes the audio through local ffmpeg.

PageMentor is a fresh build and does not fork any existing project.

## Development

This project was built in a human-in-the-loop workflow with AI assistance.
Architecture, code and configuration were created in dialogue — all
decisions were made by the human.

## License

**GNU Affero General Public License v3.0** — see [LICENSE](LICENSE).

All third-party dependencies are either MIT, Apache 2.0 or LGPL-2.1-linked,
all AGPLv3-compatible. See [NOTICE](NOTICE) for the full attribution list
and the Microsoft Neural Voice usage note.

---

[![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/lordvonbaum)

> Donations are voluntary and solely support the project. They do not
> influence the prioritisation of bugs, feature requests or support
> enquiries.
