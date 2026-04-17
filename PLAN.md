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
- **TTS**: Edge-TTS (beste Qualität) + Piper (Offline-Fallback)
- **OCR**: tesseract.js + pdf-parse
- **LLM**: Ollama (optional, für AI-Übungen + Zusammenfassungen)
- **Deploy**: Docker Compose → Portainer-Stack

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
- [x] Sprache wählbar (steuert OCR + TTS)
- [x] Tags vergeben (komma-separiert, mit Autocomplete aus bekannten Tags)
- [x] PDF-Text-Extraktion (pdf-parse mit pagerender)
- [ ] OCR für Scans (tesseract.js) — aktuell nur Text-Layer via pdf-parse;
  Bild-PDFs liefern leeren Text
- [x] Meilisearch-Index: title, tags, ocr_text, type, chapter titles
- [x] Background-Task mit SSE-Fortschritt (Progress-Bus)

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

- [x] Automatische Detection:
  - [ ] PDF-Bookmarks (nicht implementiert; pdf-parse gibt keine)
  - [x] Heading-Heuristik (Kapitel/Chapter/Teil/Modul-Regex + römische Zahlen)
  - [x] Fallback: N Seiten pro Kapitel (dynamisch 10 Slices)
- [x] Text-Cleanup pro Kapitel:
  - [x] Seitenzahlen, Kopf-/Fußzeilen raus (Frequenzanalyse)
  - [x] Silbentrennung zusammenführen
  - [x] Abbildungs-/Tabellen-Captions + Inline-Verweise entfernt
  - [ ] Formeln markieren — noch nicht
- [x] Kapitel-Editor im UI:
  - [x] Erkannte Kapitel als editierbare Liste
  - [x] Titel anpassen (Inline-Edit)
  - [ ] Grenzen verschieben (Start/End-Page) — Edit-UI fehlt
  - [x] Merge (Multi-Select)
  - [x] Delete
  - [ ] Split — nicht implementiert
  - [x] Text-Preview (Zeichen-Zähler)

---

## Phase 4 — Hörbuch

### 4.1 TTS

- [x] Engine-Abstraktion (SSML → MP3-Buffer)
- [x] **Edge-TTS** (msedge-tts): 50+ Sprachen, Neural, Studio-Qualität
  - [x] Stimmen-Auswahl pro Sprache, 3-Sekunden-Preview
  - [x] Multilingual-Voices als Flagships markiert (Seraphina, Florian, Ava, Andrew)
- [ ] **Piper** (Offline): CPU-only, kein Internet — Fallback fehlt
- [x] Settings: Stimme, Geschwindigkeit (persistent via localStorage)

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

## Noch offen (priorisierbar)

1. Piper-Fallback für TTS (offline, ohne Internet)
2. OCR via tesseract.js für Bild-PDFs
3. Cover (erste PDF-Seite) im MP3/M4B einbetten
4. Multiple-Choice-Karten-Generator mit Distraktoren
5. Gesamt-Zusammenfassung + Export (Markdown/PDF)
6. Lern-Dashboard mit Lernkurve und Themen-Schwächen
7. Kapitel-Grenzen im UI verschieben + Split-Operation
8. PDF-Viewer: Thumbnail-Sidebar + interne Text-Suche

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
