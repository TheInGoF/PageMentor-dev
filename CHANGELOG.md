# Changelog

Je Version: **New** (neu), **Change** (geändert), **Fix** (behoben). Kurze Sätze, innerhalb der Gruppe alphabetisch.
Der Windows-Build übernimmt den Abschnitt der Version als Release-Text.

## 1.26.0 – 2026-10-30
### New
- Bibliothek: Dokumente markieren, jede Zeile und die Auswahl haben ein Drei-Punkte-Menü (Öffnen, Bearbeiten, Hörbücher erstellen, Neu umwandeln, Modul zuordnen, Löschen).
- Fertiger Lauf zeigt eine Zusammenfassung mit Feuerwerk.
- Fortschritt in der Kopfzeile, Klick zeigt jedes Buch mit seinem Schritt und „Abbrechen“.
- Hörbücher für mehrere Bücher auf einmal: Umwandlung, Intro, Bereinigung, Sprachausgabe, Hörbuch-Datei und auf Wunsch Audiobookshelf, nur was fehlt.
- Lauf nach einem Neustart erst nach Bestätigung fortsetzen; weitere Bücher lassen sich nachschieben.
- Optionen vor dem Lauf: Stimme, Tempo und Audiobookshelf, vorbelegt aus den Einstellungen.
- Styleguide als docs/STYLEGUIDE.md, mit den UX-Regeln für Popups, Menüs und lange Läufe.
### Change
- Hörbuch-Lauf nutzt die Grafikkarte nie doppelt: erst alle Umwandlungen, dann Docling-Speicher freigeben, dann Buch für Buch.
- Neu umwandeln für mehrere Bücher läuft nacheinander.
- Popups schließen nur noch über „Schließen“ oder ×, nicht per Klick daneben oder Escape.
- Stift und Papierkorb in der Bibliothek sind ins Menü gewandert.
### Fix
- Dialoge in Kopfzeilen werden nicht mehr abgeschnitten.
- Upload zu Audiobookshelf öffnet keinen Browser-Tab mehr.

## 1.25.6 – 2026-10-30
### Fix
- Hörbuch erstellen übernimmt ohne Intro-Text den Vorschlag aus den Metadaten, Gemma bereinigt ihn, dann spricht die Stimme.
- Intro-Vorschlag nimmt den Titel aus den PDF-Metadaten, sonst den lesbaren Dateinamen ohne Endung.

## 1.25.5 – 2026-10-30
### Change
- Hörbuch: Vorwort und Einleitung sind standardmäßig dabei.
- Hörbuch erstellen vertont das Intro mit, wenn ein Intro-Text da ist und noch kein Audio.
### Fix
- Dialoge schließen nicht mehr, wenn man beim Markieren von Text die Maus außerhalb loslässt.

## 1.25.4 – 2026-10-29
### New
- Zusammenhänge lassen sich als JSON speichern oder kopieren, mit lesbaren Verbindungen und Kennzahlen.

## 1.25.3 – 2026-10-29
### Fix
- Hörbuch zeigt nach dem Vertonen des Intros nicht mehr dauerhaft „Generiere …“.

## 1.25.2 – 2026-10-29
### Fix
- Engine-Pakete laden auch, wenn Docker Desktop installiert ist (Anmeldung über docker-credential-desktop.exe).
- Hinweis zu sparse erscheint nicht mehr bei jedem Start, wenn WSL es nicht erlaubt.
- Kein Fehler „Failed to parse binding result as JSON“ mehr beim Öffnen des Fensters.

## 1.25.1 – 2026-10-29
### New
- Knopf „Fragen“ im Modul öffnet den Tutor mit diesem Modul als Quelle.

## 1.25.0 – 2026-10-29
### New
- Modul mit vier Reitern: Überblick, Lernen, Üben, Hören.
- Suche in der Kopfzeile, erreichbar mit Strg+K.
- Üben sammelt Lernkarten, Aufgabentrainer und Probeklausuren je Modul, mit Auswahl des Hefts.
### Change
- Bibliothek als kompakte Liste mit einer Werkzeugleiste für Typ und Modul.
- Dokument zeigt nur noch Lesen, Hörbuch und Details; Karten, Zusammenfassungen und Probeklausuren liegen im Modul.
- Einstellungen KI, Allgemein und Engine nach dem Styleguide: Einstellungszeilen, Expertenoptionen eingeklappt am Ende.
- Engine-Seite zeigt Probleme zuerst, laufende Dienste eingeklappt.
- Heute statt Startseite, ohne Dienste-Leiste und „Zuletzt hinzugefügt“; Hauptmenü Heute, Module, Plan, Bibliothek, Tutor.
- KI-Seite hat nur noch eine Modellauswahl; Cloud-Anbieter und Adressen unter „Anbieter und Verbindungen“.
### Fix
- Wissensdatenbank zeigt bei leerer Bibliothek 0 statt „{embedded}“.

## 1.24.0 – 2026-10-29
### New
- Zusatzstimmen, die 14 Tage abgeschaltet sind, werden samt Paket und Modellen gelöscht und geben Platz frei.

## 1.23.3 – 2026-10-29
### Fix
- Hörbuch-Intro nennt die gewählte Engine (F5-TTS, Kokoro, TADA) statt immer Qwen3-TTS.

## 1.23.2 – 2026-10-29
### New
- Logs zeigen auch Kokoro, F5-TTS und TADA, mit eigenem Quellen-Filter.

## 1.23.1 – 2026-10-29
### Change
- F5-TTS, Qwen und TADA starten ohne Nachfrage im Netz, sobald ihre Modelle einmal geladen sind.
- Qwen auf Deutsch: deutsche Vorlage-Stimmen stehen vorn und sind Standard statt Ryan.
### Fix
- Engine-Status wird während einer Reparatur nicht mehr dutzendfach pro Sekunde abgefragt.
- Stilles Update aus der App bricht bei wenig Speicherplatz nicht mehr ab.

## 1.23.0 – 2026-10-29
### New
- Module: Suche, Filter nach Semester, Schwerpunkt und Status, Sortierung, Gruppen je Semester.
- Module haben Fachsemester, Schwerpunkt und Prüfungsform im Bearbeiten-Dialog.
### Change
- Bibliothek: Modul-Filter als Auswahlliste, nach Semester gruppiert.
- Modulkarte zeigt Kürzel, CP, Semester und Schwerpunkt und öffnet per Klick.

## 1.22.4 – 2026-10-29
### New
- Setup warnt bei wenig Platz: unter 60 GB beim Programmordner, 15 GB beim Update, 10 GB beim Datenordner.
- Tabelle zum Speicherbedarf in README und Hilfe.

## 1.22.3 – 2026-10-29
### New
- Engine-Festplatte gibt frei gewordenen Platz automatisch an Windows zurück (sparse, fstrim).
- Große Downloads starten nur mit mindestens 15 GB freiem Speicher.
### Fix
- Volle Platte beschädigt die Engine nicht mehr mitten im Download.

## 1.22.2 – 2026-10-29
### Fix
- Zahnrad in Modul- und Dokumentansicht öffnet die Einstellungen wieder richtig statt „settings.tile.[object Object]“.

## 1.22.1 – 2026-10-29
### New
- Datenordner im Setup wählbar; vorhandene Daten werden auf Wunsch verschoben.
- Installationsort im Setup wählbar; die Engine-Festplatte zieht mit, z. B. auf D:.
### Change
- Beim Update ist der Installationsort vorbelegt, aber änderbar.
- FFmpeg, Poppler und AtomicParsley werden nur entpackt, wenn sie sich geändert haben.

## 1.22.0 – 2026-10-29
### New
- Hinweis „Update x.y.z“ in der Kopfzeile, sobald ein neueres Release da ist.
- Update aus der App: Einstellungen → Allgemein → Jetzt aktualisieren, lädt, installiert still und startet neu.
### Change
- Setup erkennt Updates und überspringt Aufgabenseite, Bereit-Seite und NVIDIA-Frage.

## 1.21.4 – 2026-10-29
### New
- Alte Paketstände werden nach dem Laden automatisch entfernt.
### Change
- Engine lädt Pakete nur, wenn sich die Pakete ändern, nicht bei jeder App-Version.
- Fortschritt zeigt „Paket 3 von 8: Name“ statt flackernder Docker-Zeilen.
### Fix
- Engine-Disk wächst nicht mehr mit jedem Update.
- Ollama wird nicht mehr bei jedem Update neu geladen.

## 1.21.3 – 2026-10-29
### New
- F5-TTS und TADA haben ab dem ersten Start Stimmen zum Klonen.
- Zwei freie deutsche Vorlage-Stimmen: Thorsten (CC0) und Hokuspokus (LibriVox, gemeinfrei).
### Change
- Vorlagen werden einmal angelegt; gelöscht bleibt gelöscht.

## 1.21.2 – 2026-10-29
### New
- Einstellung „Diagramme in Datenpunkte“ unter KI → Umwandlung der PDFs.
### Change
- Bilder erst ab 5 % der Seitenfläche beschreiben, keine Logos und Symbole mehr.
- Diagramm-Auswertung standardmäßig aus, spart 5–10 GB Grafikspeicher.
- Docling verarbeitet 2 statt 4 Seiten gleichzeitig.
### Fix
- Foliensammlungen hängen nicht mehr die ganze Nacht bei voller Grafikkarte.

## 1.21.1 – 2026-10-29
### New
- Neue Screenshots, Archiv-Ordner, überarbeitete README und Hilfe.
- Setups erscheinen als Release mit Versions-Tag.
### Change
- GitHub-Actions laufen auf Node 24.
### Fix
- Ein Aussetzer des Arbiters löscht die Engine-Liste nicht mehr.
- Kokoro ist direkt nach dem Start in der Stimmenauswahl.

## 1.21.0 – 2026-10-28
### New
- Kokoro ist Standardstimme und immer installiert.
- Stimmen-Menü nach dem UI-Styleguide: Karten, Einstellungszeilen, Expertenbereich.
### Change
- Aufnahmen und Beschreibungen stehen in einer Liste „Eigene Stimmen“.
- Bestehende Installationen behalten Qwen.
- Qwen3-TTS ist optional wie F5 und TADA.

## 1.20.9 – 2026-10-28
### Change
- Arbiter reicht Modellliste und Statusabfragen ohne Grafikkarte durch.
### Fix
- Hörbuch-Vorverarbeitung bricht nicht mehr mit „No LLM provider configured“ ab, wenn eine Stimme spricht.

## 1.20.8 – 2026-10-28
### New
- Kokoro bekommt die Frauenstimme Kerstin.
### Change
- Tempo bei Kerstin über ffmpeg, das Modell kann es nicht selbst.

## 1.20.7 – 2026-10-28
### Change
- Hinweis: Stimmproben gelten auch für F5-TTS und TADA.

## 1.20.6 – 2026-10-28
### New
- Docling gibt den Grafikspeicher nach drei Minuten Ruhe frei.

## 1.20.5 – 2026-10-28
### Fix
- Gestoppter Qwen-Container erzeugt keine Warnung im Log mehr.

## 1.20.4 – 2026-10-28
### Fix
- Arbiter und Qwen-TTS kommen aus den aktuellen Paketen, Kokoro und F5 erscheinen wieder.

## 1.20.3 – 2026-10-28
### New
- Nach jedem App-Update lädt die Engine neue Paketstände.
### Fix
- Veraltete Engine-Pakete bleiben nicht mehr liegen.

## 1.20.2 – 2026-10-28
### New
- Selbsttest und Reparatur „Docling-Modelle“.
### Fix
- Docling scheitert nicht mehr an fehlenden Modellen für Bildbeschreibung.

## 1.20.1 – 2026-10-28
### Change
- Import-Ordner rechnet bekannte Dateien nicht bei jedem Durchlauf neu.
- Textvergleich für Dubletten ohne Bilder, Kommentare und LaTeX.
### Fix
- Automatisches und manuelles Einlesen laufen nicht mehr doppelt.
- Halb kopierte PDFs werden erst nach einer Minute Ruhe eingelesen.

## 1.20.0 – 2026-10-28
### New
- Docling in höchster Stufe mit Bildbeschreibung.
- Dubletten werden vor der Umwandlung erkannt.
- Import-Ordner, der automatisch eingelesen wird.
- Lesbare Wissensdatenbank als Ordner mit Markdown und Bildern.
### Change
- Neuer Versuch nach Fehler nutzt das Dokument aus dem ersten Lauf.
