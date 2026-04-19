# PageMentor — Roadmap

doc_storage-Oberfläche (vereinfacht) + Lerntools. Kein Login, keine
Baumstrukturen, Tags statt Zweige. Lokal, Portainer-Stack.

---

## Konzept

```text
┌─────────────────────────────────────────────────┐
│  Bibliothek (doc_storage-Style)                 │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐  │
│  │Studienheft │ │  Script    │ │  Klausur   │  │
│  │ BWL-01     │ │  Statistik │ │  WS 2024   │  │
│  │ #bwl #sem3 │ │  #stats    │ │  #übung    │  │
│  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘  │
│        │              │              │          │
│        ▼              ▼              ▼          │
│  ┌─────────────────────────────────────────┐    │
│  │  Lernmenü (pro Dokument)               │    │
│  │  ┌──────────┐ ┌──────────┐ ┌────────┐  │    │
│  │  │ Kapitel  │ │ Hörbuch  │ │Übungen │  │    │
│  │  │ & Text   │ │ Player   │ │& Karten│  │    │
│  │  └──────────┘ └──────────┘ └────────┘  │    │
│  │  ┌──────────┐ ┌──────────┐ ┌────────┐  │    │
│  │  │AI Übungen│ │ Klausur- │ │Zusammen│  │    │
│  │  │Generator │ │ Trainer  │ │fassung │  │    │
│  │  └──────────┘ └──────────┘ └────────┘  │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│  Volltextsuche (Meilisearch) über alles         │
└─────────────────────────────────────────────────┘
```

**Navigation**: Bibliothek → Doppelklick auf Dokument → Lernmenü

**Organisation**: Tags statt Baumstruktur (`#bwl`, `#semester3`, `#klausur`, `#übung`)

---

## Stack

- **Frontend**: React 19 + Vite + TypeScript + Tailwind (kopiert von doc_storage)
- **Backend**: Bun + Hono (TypeScript durchgängig)
- **DB**: SQLite (kein Postgres für lokales Tool)
- **Suche**: Meilisearch (gleicher Container wie doc_storage oder eigener)
- **Text-Extraktion**: Docling-Serve (CPU-Image, Layout-Modell mit Section-
  Header-Erkennung). Manuell gestartet pro Upload, 15–30 s/Seite auf CPU.
- **TTS**:
  - **Default: Kokoro** als Sidecar-Container (Apache 2.0, lokal,
    OpenAI-kompatible API via remsky/Kokoro-FastAPI). Hörbuch-tauglich
    auch für lange wissenschaftliche Texte, für Hochschulen und Firmen
    empfehlbar. CPU-Default (~3-5x Realtime), GPU-Override via
    `docker-compose.gpu.yml` (~30-50x auf 3090).
  - **Deutsche Voices** über zweiten optionalen Sidecar `kokoro-de`
    (r1di/kokoro-fastapi-german, Tundragoon/Kokoro-German v1.1):
    `df_eva` (weiblich) und `dm_bernd` (männlich). Aktivieren mit
    `--profile de` oder als externer Sidecar auf einem stärkeren Host.
    Backend mergt die Voice-Listen beider Sidecars und routet
    Synthese-Calls anhand der Voice-ID.
  - **Fallback: Edge** (msedge-tts, Microsoft Neural Voices) als
    Cloud-Option ohne Setup. Bleibt im Voice-Picker auswählbar.
  - **Audio-Preprocessor**: Vor jedem Kapitel läuft der LLM einmal
    über den Text und macht ihn TTS-tauglich (Abkürzungen ausschreiben,
    Formeln verbalisieren, Zitate strippen, Aufzählungs-Marker
    entfernen). Cached in `chapters.audio_text` — beim zweiten Run
    kein LLM-Call mehr.
- **LLM**: Ollama + Provider-Chain (Claude / OpenAI / Gemini als Fallback,
  alle Endpoints zur Laufzeit in Settings konfigurierbar)
- **RAG-Embeddings**: Auto-Detect via Ollama-Tags. Präferenz für
  deutsche Studientexte:
  1. `jina/jina-embeddings-v2-base-de` (Apache 2.0, bilingual DE+EN,
     768 dim, 8k Kontext, ~440 MB) — explizit auf DE trainiert,
     schlägt bge-m3 für deutsche Inhalte
  2. `bge-m3` (multilingual Allrounder) als Fallback bei mehrsprachiger
     Bibliothek
  3. `nomic-embed-text` als finaler Fallback
  Re-Embed bei Modell-Wechsel via Settings-Modal-Button oder
  `POST /api/rag/reembed`.
- **Deploy**: Docker Compose → Portainer-Stack (app + meilisearch +
  docling + kokoro)

**Theme**: Night-Default — `#000` Backgrounds, `#111` Elevated, **rote Akzente** (`#ef4444`)

**Einfache Absicherung**: ein Passwort via Env-Var (`PM_PASSWORD`), kein
Username, kein Multi-User. Login-Screen fragt nur das Passwort, setzt
einen Cookie, fertig. Damit erreichbar von überall ohne dass jeder rein kann.

---

## Phase 1 — Infrastruktur

- [x] Repo init: `backend/` (Bun + Hono) + `frontend/` (Vite + React)
- [x] docker-compose.yml: Backend + Meilisearch + (optional) Ollama via Profile `ai`
- [x] Styles von doc_storage übernehmen:
  - [x] Night-Mode CSS (styles.css Catch-All-Rules)
  - [x] Tailwind-Config mit roten statt blauen Akzenten
  - [x] Button, Input, Modal, Toast Komponenten
  - [x] cn() Helper, i18n-System (DE/EN, EN als Default, persistent via Settings)
- [x] SQLite Schema:

  ```sql
  documents   (id, title, filename, stored_path, mime_type, size_bytes,
               page_count, ocr_text, ocr_status, type, created_at)
  tags        (id, label)
  document_tags (document_id, tag_id)
  chapters    (id, document_id, number, title, start_page, end_page,
               text, sort_order)
  audio       (id, chapter_id, stored_path, duration_ms, engine, voice,
               status, created_at)
  cards       (id, document_id, chapter_id, question, answer, hint,
               difficulty, source_page, source, created_at)
  progress    (id, card_id, last_seen, next_review, ease, reps, streak)
  summaries   (id, chapter_id, level, content, model, created_at)
  exam_sessions (id, document_id, title, card_ids_json, answers_json,
                 score, total, planned_duration_ms, taken_ms, status,
                 created_at, finished_at)
  ```

- [x] File-Storage: `./data/uploads/` + `./data/audio/`
- [x] Auth: ein Passwort aus `PM_PASSWORD` Env-Var, Cookie-Session
- [x] Health + SSE-Bus (`/api/audio/stream/:docId` als Pipeline+Audio-Stream)

---

## Phase 2 — Bibliothek (doc_storage-Style)

### 2.1 Upload + OCR

- [x] Upload-Endpoint (Multipart, Drag-Drop, Batch mit mehreren Files)
- [x] Dokumenttyp wählbar: Studienheft / Script / Klausur / Übung / Sonstiges
- [x] Sprache wählbar (steuert TTS + OCR-Sprache für Docling)
- [x] Tags vergeben (komma-separiert, mit Autocomplete aus bekannten Tags)
- [x] PDF-Text-Extraktion via Docling-Serve (layout-aware, Section-Header-
  Erkennung, Header/Footer/Caption/TOC-Labeling)
- [x] Upload triggert **nicht** automatisch — User startet Docling manuell
  pro Dokument (Status `awaiting-extraction`)
- [x] OCR automatisch durch Docling für Bild-PDFs (RapidOCR / Tesseract)
- [x] Meilisearch-Index: title, tags, ocr_text, type, chapter titles
- [x] Background-Task mit SSE-Fortschritt (Progress-Bus)
- [x] Docling-Status als Live-Indikator im Settings-Panel

### 2.2 Bibliotheks-Ansicht

- [x] doc_storage-Card-Grid (statt Tabelle) mit Pipeline-Dots
  - [x] Karten-Grid (Text · Kapitel · Audio · Karten · Zsf. live)
  - [x] Felder: Titel, Typ, Tags, Seiten, Status, MB, Pipeline-Fortschritt
  - [x] Doppelklick → Lernmenü
- [x] Suche: Meilisearch-Volltextsuche über alles (Topbar mit Highlights)
- [x] Filter: nach Tags (Chips), nach Typ, Freitext lokal
- [x] Tag-Multi-Select (Chips-basiert, Autocomplete)
- [x] Aktionen: Bearbeiten (Titel/Typ/Tags), Löschen, Pipeline-Retry
- [x] Empty State mit Upload-CTA

### 2.3 PDF-Viewer

- [x] react-pdf Viewer mit Continuous-Scroll
- [ ] Thumbnail-Sidebar — aktuell Seiten-Eingabe als Jumper, keine Thumbs
- [x] Zoom (50–250 %)
- [ ] Suche im Viewer (Text-Find inner PDF)
- [x] Aus dem Viewer heraus: "Als Lernkarte markieren" (Text-Selektion →
  Modal mit vorausgefüllter Frage)

---

## Phase 3 — Kapitel-Erkennung

Seit v1.11.000: Docling macht die gesamte Layout-Analyse. Unsere eigene
Heading-Heuristik (ChapterDetection in `chapters.ts`) ist obsolet,
pdf-parse wurde rausgeflogen.

- [x] Docling liefert section-header-Items mit level-Zahl aus dem
  Layout-Modell — wir picken das kleinste level mit ≥ 3 Vorkommen als
  Kapitel-Grenze (adaptiert automatisch H1-first vs. H2-first).
- [x] Role-Filtering: Items mit label=page_footer/page_header/page_number/
  caption/furniture werden gedroppt → keine Studien-Kürzel, TOC-Zeilen,
  Watermarks mehr im Kapiteltext.
- [x] Text-Cleanup als Paranoid-Post-Pass: Unicode-Normalisierung +
  Ligaturen + Soft-Hyphen-Strip + XML-invalide Control-Chars killen.
- [x] Kapitel-Editor im UI:
  - [x] Erkannte Kapitel als editierbare Liste
  - [x] Titel anpassen (Inline-Edit)
  - [x] Merge (Multi-Select)
  - [x] Delete
  - [x] Text-Preview (Zeichen-Zähler)
  - [ ] Grenzen verschieben (Start/End-Page) — Edit-UI fehlt
  - [ ] Split — nicht implementiert

---

## Phase 4 — Hörbuch

### 4.1 TTS

- [x] Engine-Abstraktion (Dispatcher in `tts/synth.ts`, Engine-Interface in
  `tts/engines/base.ts`) — bereit für spätere Engines (Kokoro / XTTS), falls
  Edge mal dauerhaft bricht
- [x] **Edge-TTS** (msedge-tts ^2.0.5, minimal-SSML-Template seit v1.10.006
  damit Azure keine silent-rejects mehr macht)
  - [x] Stimmen-Auswahl pro Sprache, 3-Sekunden-Preview
  - [x] Multilingual-Voices als Flagships (Seraphina, Florian, Ava, Andrew)
- [x] Edge-Rate-Limit-Handling: 1500 ms Inter-Chunk-Pause + 30 s Cooldown
  nach Empty-Audio + Circuit-Breaker nach 2 konsekutiven Empty-Chapters
- [x] Dependabot-PR daily für msedge-tts (Microsoft tightent alle 6–12
  Monate, wir ziehen binnen 1–14 Tagen nach)
- [x] Settings: Stimme, Geschwindigkeit (persistent via localStorage)
- [x] Piper endgültig entfernt (v1.11.001) — DE-Qualität nicht
  Studienheft-tauglich. **Kein Re-Add geplant**.
- [x] **Kokoro-Sidecar als Default-TTS** — lokales Apache-2.0-Modell
  via remsky/Kokoro-FastAPI. CPU-Default, GPU-Override über zweites
  Compose-File (analog Docling). Edge bleibt als Zweit-Provider im
  Picker.
- [x] **LLM-Audio-Preprocessor** — Ollama bereinigt Kapiteltext für
  TTS (Abkürzungen, Formeln, Zitate, Bullet-Listen). Cached in
  `chapters.audio_text`. Bei manuellen Kapitel-Edits oder Merge wird
  der Cache automatisch invalidiert.

### 4.2 Generierung

- [x] Kapitelweise Background-Task
- [x] SSE: phase/current/total Events, persistent Ring-Buffer
- [x] Pausen: SSML-Breaks (600 ms Absatz, 1200 ms vor Kapitelansage)
- [x] Kapitelansage am Anfang
- [x] ffmpeg: EBU R128 Loudnorm + MP3 (128 kbps)
- [x] Kompletter Lauf regenerierbar (einzel-regen nur implizit über full-regen)

### 4.3 Player

- [x] Inline-Player pro Kapitel (HTML5-audio, Range-Requests)
- [x] Playback-Speed (Browser-native via HTMLMediaElement.playbackRate)
- [x] Kapitel-Sprung (M4B enthält `TIMEBASE=1/1000` FFMETADATA-Chapters)
- [x] Download: einzelne MP3s + komplett (M4B mit Kapitelmarken)
- [x] **An Apple senden**: M4B-Download + privater RSS-Feed für Apple
  Podcasts / Overcast (Token aus PM_PASSWORD, `podcast://` Deeplink)
- [ ] Cover = erste PDF-Seite (PDF-Page-Render → JPG → mjpeg embed)

---

## Phase 5 — Übungen & Lernkarten

### 5.1 Aufgaben-Extraktion

- [x] Pattern-Erkennung aus PDF-Text:
  - [x] "Aufgabe N:", "Exercise N:", "Frage N:", "Problem N:", "Übung N:"
  - [x] Nummerierte Blöcke (1. / a) / i.)
  - [x] "Lösung:", "Musterlösung:", "Solution:", "Answer:" als Trenner
- [x] Matching Aufgabe ↔ Lösung (gleiche Nummer, dann in Reihenfolge)
- [x] Review-UI: extrahierte Karten ausklappbar, editieren, löschen

### 5.2 AI-Übungen (Ollama)

- [x] Aus Kapiteltext neue Übungsaufgaben generieren
- [x] Schwierigkeit wählbar (Leicht / Mittel / Schwer)
- [x] Stil (Grundlagen / Vertiefung / Klausur)
- [x] Robuster JSON-Parser für Modell-Antworten
- [ ] Multiple-Choice mit plausiblen Distraktoren
- [ ] Offene Fragen mit Muster-Antwort (implizit durch answer-Feld; kein
  strukturiertes MC)
- [ ] "Mehr Aufgaben zu diesem Thema" — aktuell nur pro Kapitel

### 5.3 Lernkarten-Modus

- [x] Karteikarten-Ansicht:
  - [x] Frage groß → Tap/Space → Lösung aufdecken
  - [x] ✓ Gewusst / ~ Teilweise / ✗ Nicht gewusst
  - [x] Hint-Button (zeigt Hinweis vor Lösung, falls hinterlegt)
- [x] Spaced Repetition (SM-2 mit Quality 1/3/5, Ease ≥ 1.3)
- [x] Filter: Kapitel
- [ ] Filter: Schwierigkeit, Quelle (extrahiert/KI/manuell) — Quelle wird
  im Row angezeigt, aber kein dedizierter Filter
- [x] Session-End-Zusammenfassung (gewusst/teils/nicht gewusst)
- [ ] Lernkurve-Chart über Zeit — aktuell nur Aggregat-Stats
- [x] Shuffle-Modus (RANDOM() in due-Query)
- [x] CSV-Export/Import (Anki-kompatibel)

### 5.4 Klausur-Trainer

- [x] Klausur-Simulation:
  - [x] X Aufgaben auswählen (10/20/30/50)
  - [x] Timer (30/60/90/120 min oder ohne Limit)
  - [x] Auto-Abgabe bei Timeout
  - [x] Abgabe → Selbst-Bewertung mit Musterlösungs-Vergleich
  - [x] Score = %gewusst (q=5 voll, q=3 halb)
- [ ] Kernthemen-Analyse (Tags als Cluster, Schwächen-Hinweise)
- [x] Historie: alle Sessions mit Score-Verlauf (Sparkline)

---

## Phase 6 — Zusammenfassungen (Ollama)

- [x] Kapitelweise: Bullet-Points / 1 Absatz / Ausführlich
- [x] Model-Picker (alle via `ollama list` sichtbaren Modelle)
- [x] Streaming-Ausgabe (NDJSON, Token-für-Token mit Caret-Animation)
- [ ] Gesamt-Zusammenfassung in 1 Seite (alle Kapitel zusammen)
- [ ] Kernthemen pro Kapitel als Tags extrahieren
- [ ] Export: Markdown / PDF
- [ ] Side-by-Side: Original ↔ Zusammenfassung

---

## Phase 7 — UI

### Layout

- [x] Zwei Ebenen: Bibliothek + Lernmenü (Sub-Tabs)
- [x] Lernmenü-Tabs: Lesen · Kapitel · Hörbuch · Übungen · Klausur · Zsf.
- [x] Topbar: Volltextsuche + Settings-Zahnrad + Upload + Logout
- [x] Night-Default (schwarz + rot)
- [x] Responsive (mobile, tablet, desktop — `md:` breakpoints durchgängig)
- [x] Keyboard-Shortcuts mit `?`-Help-Overlay

### Fortschritt

- [x] Pipeline-Status pro Dokument (Dots + Live-SSE-Message):

  ```text
  ● Text ─› ● Kapitel ─› ◐ Audio (4/12) ─› ○ Karten ─› ○ Zsf.
  ```

- [x] SSE-Live-Updates (Bibliothek + Hörbuch-Tab)
- [ ] Lern-Dashboard als Landing: Karten gelernt, Streak, schwache Themen

### Settings

- [x] Interface-Sprache (EN/DE, Auto-Detect aus Browser)
- [x] TTS-Stimme + Geschwindigkeit
- [x] Default-Upload-Sprache
- [x] Ollama-Modell-Override (wenn Ollama online)
- [ ] Audio-Qualität (derzeit fix 128 kbps MP3 / 96 kbps AAC M4B)
- [x] Live-Status-Ampeln für Meilisearch + Ollama

---

## Mehrsprachigkeit

- [x] Frontend: React-Hook `useLocale()` + zentrales Dict (EN + DE)
- [x] Default-Sprache: EN, Auto-Detect Browser, Override in Settings
- [x] Backend: `Accept-Language`-Header parsen, Fehlermeldungen dict-basiert
- [x] Summary-Prompts zweisprachig (basierend auf `document.language`)

---

## Noch offen (priorisiert, Stand v1.11.010)

### Abgeschlossen — v1.11.010 (RAG-Backend)

- [x] **Docling-Artefakte pro Dokument auf Disk dumpen**
  `uploads/<doc-id>/docling/full.md` + `document.json`.
- [x] **Chunking + Embeddings**: paragraph-aware Chunker, 800 Tok
  Target / 100 Tok Overlap. Chunks als JSON + SQLite `chunks`-Tabelle
  mit Embedding-BLOB (768 float32). `nomic-embed-text` via Ollama
  (~137 MB, CPU-tauglich), Fallback ohne Embeddings möglich.
- [x] **RAG-Query-Endpoint** `POST /api/rag/query` mit Brute-force
  Cosine-Similarity, `{query, docId?, topK?}`.

### Nächste Runde — v1.11.011

- **RAG-UI**
  Frage-an-Dokument-Overlay mit Ergebnis-Snippets und Chapter-
  Verlinkung, optional „Frage an gesamte Bibliothek"-Modus. Nutzt den
  bestehenden `/api/rag/query`-Endpoint.

- **Prosodie-Polisher für Audiobook**
  Optionaler Ollama-Pass *nach* Docling, *vor* Edge-TTS: LLM rewrites
  Kapiteltext für besseres Hörerlebnis — Akronyme auflösen,
  Schachtelsätze kürzen, Gedankenstrich-Einschübe umbrechen,
  Markdown/Formatierung raus. Original bleibt unverändert (Text-View
  und Cards nutzen weiterhin die saubere Docling-Fassung).

- **Tabellen & Bilder in Kapiteltext einschließen**
  Aktuell filtern wir `label: "table"` und `label: "picture"`
  komplett raus. Für Card-Generierung sollten sie aber enthalten
  sein — Tabellen als Markdown-Tabelle (Docling liefert das bereits),
  Bilder als Caption-Text. TTS-Pfad darf sie weiterhin droppen
  (Prosodie-Polisher kann das übernehmen), Chunker + Card-Extractor
  brauchen sie.

### Mittelfristig

- **Cover (erste PDF-Seite) im MP3/M4B einbetten**
  Wir rendern's schon via poppler, nur das ffmpeg-Embed fehlt.

- **Multiple-Choice-Karten mit plausiblen Distraktoren**
  Aktuell freie Antwort; MC-Generator via Ollama + Quality-Prompt.

- **Gesamt-Zusammenfassung + Export**
  Alle Kapitel-Zsf zu einer Dokument-Zsf verknüpfen, dann
  Markdown- / PDF-Export.

- **Lern-Dashboard als Landing**
  Streak, Lernkurve über Zeit, Themen-Schwächen aus Card-Quality-
  Historie.

- **Kapitel-Grenzen verschieben + Split**
  Edit-UI fehlt; aktuell nur Merge + Delete + Rename.

- **PDF-Viewer-Thumbnails + interne Text-Suche**
  Seiten-Jumper vorhanden, aber keine Sidebar-Thumbs, kein
  Volltextsuche innerhalb des Viewers.

### Hardware / Deployment

- **GPU-Server-Pfad vorbereitet**: `docker-compose.gpu.yml` tauscht das
  Docling-Image gegen die CUDA-Variante (v1.11.008). Empfehlung für
  den nächsten Hardware-Schritt: Desktop-Tower + RTX 3090 gebraucht
  → Docling-Extraktion 20–60 s statt 25–70 min pro 100-Seiten-PDF,
  Ollama flüssig bis 13B-Modelle.

- **Persistenter Docling-Task-State**: aktuell verlieren wir bei
  pm-app-Restart das `running`-Map → orphaned docling-Task in der
  Queue. Startup-Reset cleart die DB-Row, aber die Lösung wäre die
  docling-task-id in der DB zu persistieren + auf Start wieder zu
  abonnieren (oder alle offenen docling-Tasks zu canceln). Niedrige
  Prio, workaround via „pm-docling restart" reicht.

### Log-Cosmetics

- **WebSocket-Fallback-Polling nur bei State-Change loggen** — aktuell
  macht die WS-Path ein clean Event-Log, aber wenn WS wegbricht und
  Polling übernimmt, könnte das wieder spammig werden. Wert abwarten
  und notfalls nachziehen.

---

## Übernommene Komponenten von doc_storage

| Komponente | Anpassung |
| --- | --- |
| `styles.css` (Night-Mode) | Akzentfarbe → rot |
| `tailwind.config.ts` | `accent` → `#ef4444` |
| `Button`, `Input`, `Modal`, `Toast` | Farbe getauscht |
| `cn()`, `i18n`-System | Erweitert um `useLocale`-Hook |
| `DocumentTable` | → Card-Grid statt Tabelle |
| `TagMultiSelect` | → `TagInput` mit Chip-Autocomplete |
| PDF-Viewer (`react-pdf`) | Plus Text-Selection-to-Card |
| Topbar + Suchfeld | Vereinfacht, plus Settings-⚙ |
