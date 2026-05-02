# Safety: Content-Validation gegen Voice-Deep-Fake-Missbrauch

Stand: 2026-05-02

## Threat-Modell

PageMentor kann mit Voice-Clone (User-Sample-Upload) und User-eingegebenem
Text eine TTS-Audio-Datei erzeugen. Das ist die exakte Pipeline die für
Voice-Deep-Fakes gebraucht wird:

1. Stimme einer Zielperson hochladen (10s Clone)
2. Beliebigen Text eingeben
3. Audio raus → an Familie/Bank/Behörde schicken

Das Tool ist hobby-/lernzweckorientiert. Wir wollen den ehrlichen Use-Case
(Vorlesungsskript für die Bahnfahrt) NICHT verhindern, aber Voice-Deep-Fakes
strukturell ausschließen — auch wenn der Schutz nicht 100% ist, soll er
"böse Hobbyisten" abweisen und sie zu einem anderen Tool zwingen.

Profis mit echter krimineller Energie können andere Tools nutzen. Wir
dichten gegen Gelegenheits-Missbrauch ab, nicht gegen state-actors.

## Kern-Prinzip: undokumentierte Ablehnung

Validierung läuft im Hintergrund. Wenn sie fehlschlägt:
- Tool zeigt einen generischen Fehler ("Verarbeitung fehlgeschlagen")
- KEINE Erklärung warum
- KEINE Hinweise wie der User den Check umgehen könnte
- KEIN Whitelist-/Allowlist-Mechanismus den User entdecken kann

**Begründung:** wenn wir dokumentieren "wir lehnen X ab", versuchen Bad
Actors X zu tarnen. Wenn wir es nicht dokumentieren, versuchen sie es gar
nicht erst — sie suchen ein anderes Tool.

## Drei Validierungs-Stufen

### Stufe 1: Docling-Layer-Verifikation

Beim PDF-Upload prüft Docling (oder ein Post-Processor auf den Docling-
Layout-Daten):

**Was ist ein zulässiges Dokument:**
- Wissenschaftliche Paper (zwei-spaltiges Layout, Abstract, References,
  DOI/arXiv-ID)
- Bücher (Kapitel-Struktur, ISBN, Verlags-Metadaten, Inhaltsverzeichnis)
- Studienhefte (Lernziele, Übungs-Markups, Selbstkontroll-Fragen,
  Verlags-Codes wie "FH-Wedel SE12k")
- Klausuren (Aufgaben-Nummerierung, Punkte-Verteilung, Modul-Header)
- Vorlesungs-Skripte (Foliennummern, Dozenten-Header, Universitäts-Logo)

**Was nicht:**
- Reine Fließtext-PDFs ohne Struktur
- Word-Exports ohne Titelseite
- Markdown/Plaintext-Konvertierungen
- Selbst-formatierte Texte mit dünnem Layout-Signal
- Sehr kurze Dokumente (<3 Seiten ohne Buch-/Paper-Indikatoren)

**Implementierung:**
- Docling-Output enthält Layout-Klassen pro Seite (paragraph, table,
  caption, header, footer, etc.). Counter über das ganze Dokument
- Score = gewichtete Summe der "echten Dokument"-Indikatoren minus
  "selbst-gebastelt"-Indikatoren
- Schwellwert calibriert auf 95% der bisherigen Test-PDFs (alle echt) +
  Sammlung von 20-30 selbst-gebastelten Test-Dokumenten (Word-Briefe,
  Plaintext-Konvertierungen, etc.) zum Vergleich

**Bei Fail:** Document-Status = "extraction-failed" mit generischem
Error. Datei bleibt liegen, kann manuell vom Admin angesehen werden.
Kein Hinweis dass es am Validierungs-Score lag.

### Stufe 2: Gemma-Content-Verifikation

Nach Text-Extraktion prüft gemma3:e4b den extrahierten Text:

**Prompt** (intern, nicht in Logs sichtbar machen die der User sehen kann):
```
Du bist ein Klassifikator. Antworte ausschließlich mit "PUBLISHED" oder "OTHER".

PUBLISHED = der Text stammt aus einem veröffentlichten Werk:
- Wissenschaftliches Paper
- Lehrbuch oder Studienheft
- Universitäts-Vorlesungsskript
- Veröffentlichter Roman, Sachbuch
- Klausur oder offizielles Übungsmaterial

OTHER = der Text wurde wahrscheinlich vom User selbst erstellt:
- Persönliche Notizen
- Briefe oder Mitteilungen
- Reden oder Ansprachen
- Gedichte oder Songtexte ohne Verlag
- Reine Information ohne wissenschaftlichen oder pädagogischen Rahmen
- Kurze Texte ohne Quellen, Referenzen, Lernziele
- Anything that reads like one person speaking to one specific recipient

Text:
<erste 8000 Zeichen des extrahierten Texts>
```

**Bei OTHER:** Document wird als nicht-prozessbar markiert. Audio-
Generation wird blockiert. Generischer "Verarbeitung fehlgeschlagen"-
Fehler.

**Bei PUBLISHED:** Pipeline läuft normal weiter.

**Robustheit gegen Bypass:**
- Prompt mit zwei Beispielen pro Kategorie ergänzen (Few-Shot)
- Wenn User "im Stil eines Lehrbuchs" geschriebenes Material hochlädt,
  greift Stufe 1 als zweite Linie (Layout passt nicht)
- Random-Sampling über Mid-Document-Chunks zusätzlich zum Anfang
- Periodisches Re-Calibrieren mit neuen Beispiel-Texten

**Caveat:** kein LLM-Klassifikator ist 100%. Wir akzeptieren False-
Positives (echte Dokumente werden gelegentlich als OTHER klassifiziert
→ User muss sich beschweren) als Preis für die Unmöglichkeit System-
atischer Bypass-Versuche.

### Stufe 3: Text-Editor-Funktion entfernen

**Status quo:** User kann den extrahierten Kapitel-Text in der UI
editieren (z.B. um Captions zu entfernen die unser Pre-Processor übersah).

**Neu:** Text-Edit-Funktion fliegt raus. Begründung: ein User der den
Text editieren kann, kann nach Stufe-1+2-Pass beliebigen Text einfügen
und dann TTS-en.

**Konsequenz für legitime User:**
- Pre-Processor + Ollama-Cleanup müssen härter werden (mehr Edge-Cases
  abfangen ohne menschliches Nachbearbeiten)
- Audio-Text-Cache (`chapters.audio_text`) wird read-only fürs Frontend
- Settings → Audio-Text-Edit-Tab raus
- API-Endpoint `PATCH /api/audio/preprocessed/:chapterId` entfernen

**Die Härte ist Absicht:** wir verlieren ein bisschen UX-Komfort,
gewinnen wir vollständige Kontrolle über den Text der zur TTS geht.

### (Optional) Stufe 4: Voice-Clone selbst absichern

Voice-Clone-Upload IST das andere Ende der Deep-Fake-Pipeline. Stufen
1-3 sichern den Text-Input ab. Voice-Clone bleibt aber problematisch
weil:
- Sample = Stimme einer realen Person ohne ihre Einwilligung
- Mit Stufen 1-3 kann der User immer noch die Stimme klonen + ein
  legit-aussehendes Buch vortragen lassen → Hörbuch mit Sammys
  Stimme das Sammy nie genehmigt hat → Persönlichkeitsrechts-Verletzung

**Mögliche Maßnahmen:**
- **Consent-Checkbox** beim Upload: "Ich bestätige dass ich die
  Erlaubnis der gesprochenen Person habe oder dies meine eigene
  Stimme ist." Schwach, aber rechtlich relevant.
- **Watermarking** in den TTS-Output: Audible Tag oder Inaudible
  Steganographie die das generierte Audio als KI-Output kennzeichnet.
  Anti-Bypass-Schicht.
- **Voice-Sample-Hash-Limit**: max N verschiedene Voice-Samples pro
  Installation. Heimanwender hat 1-3 eigene Stimmen, Bad Actor
  müsste viele Stimmen klonen.

Stufe 4 ist nice-to-have, nicht Teil der initialen Implementierung.

## Implementierungs-Reihenfolge

1. **Stufe 3 (Text-Editor raus)**: technisch trivial — Frontend-UI
   entfernen, API-Endpoint löschen. ~2h.
2. **Stufe 1 (Docling-Validierung)**: brauche Layout-Score-Heuristik
   + Test-Set kuratieren. ~1-2 Tage.
3. **Stufe 2 (Gemma-Validierung)**: Prompt-Engineering + Chain in
   die Pipeline einbauen. ~6-8h. Hängt von Stufe 1 ab (beide müssen
   Document blockieren können bevor Audio-Generierung beginnt).
4. (optional) **Stufe 4**: separates Folge-Projekt nach 1-3.

## Was NICHT dokumentieren

- Diese Datei selbst NICHT in das Public-Repo pushen (PageMentor-Public)
- Im Code: Validierungs-Funktionen mit harmlosen Namen
  (`extractionPlausibility`, `documentClassify`) statt
  `antiDeepfakeFilter`
- Error-Messages in der UI: "Verarbeitung fehlgeschlagen, bitte
  später erneut versuchen" oder "Dokument konnte nicht verarbeitet
  werden". KEIN "Validierung fehlgeschlagen", KEIN "Inhalt nicht
  zulässig"
- Logs intern dürfen klar sein — nur was der User sieht ist
  generisch
- Keine GitHub-Issues, keine Commit-Messages die "deepfake" /
  "missbrauch" / "validation" als Stichwort haben. Stattdessen:
  "input quality check", "extraction reliability filter"

## Trade-Offs

**Was wir verlieren:**
- Legitime kurze Texte (3-Seiten-Notiz für Klausurvorbereitung)
  werden u.U. abgelehnt
- Eigene Vorlesungs-Mitschriften ohne offiziellen Layout-Stil
  werden abgelehnt
- Kreativer Schreibstil der zwischen Buch und Notiz pendelt
  → hit-and-miss
- Text-Edit für Audio-Cleanup geht verloren — User muss sich auf
  Pre-Processor verlassen

**Was wir gewinnen:**
- Tool kann nicht trivial für Voice-Deep-Fakes missbraucht werden
- Klare Position für Demonstration / Vortrag / öffentlichen Use:
  "wir machen Hörbücher aus Lernmaterial, sonst nichts"
- Falls jemand das Tool dokumentiert (Blog, YouTube): die
  Reibungspunkte für Missbrauch sind hoch genug dass es nicht
  als "Deep-Fake-Tool" hängenbleibt
- Persönliche Sicherheit: wenn jemand den Repo forkt und damit
  Schaden anrichtet, gibt's mehrere Layer aktiver Anti-Missbrauchs-
  Maßnahmen die "wusste nicht dass das geht" weiter wegrücken

## Decision-Punkte vor Start

1. **Test-Set kuratieren**: 30+ echte Lehrbücher/Skripte (PASS-Set) +
   30+ selbst-gebastelte Beispiele (FAIL-Set) als Calibration-Material.
   Ohne das ist Stufe 1+2 nur geraten.
2. **False-Positive-Rate festlegen**: 5%? 10%? Bestimmt Schwellwert.
3. **Recovery-Pfad für Falsch-Abgewiesene**: gar nicht (User probiert
   andere PDF), oder versteckter Admin-Override?
