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
| `PM_OLLAMA_URL` | `http://ollama:11434` | Ollama endpoint (optional) |
| `PM_OLLAMA_MODEL` | `llama3.1:8b` | Default model |

Meilisearch and Ollama are both optional. Without Meilisearch the full-text
search disables itself; without Ollama the summary and AI-card tabs show
a clear "not reachable" hint and the rest of the app keeps working.

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
