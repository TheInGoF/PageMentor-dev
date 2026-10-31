# Changelog

Je Version: **New** (neu), **Change** (geändert), **Fix** (behoben). Kurze Sätze, innerhalb der Gruppe alphabetisch.
Der Windows-Build übernimmt den Abschnitt der Version als Release-Text.

## 1.42.0 – 2026-10-31
### Change
- Tutor: jedes Modell hat ein eigenes Budget; das kleine Modell antwortet mit 64k Kontext, bis zu 30 Quellen und 12 Gesprächsrunden, Gemma 26B mit 20 Quellen, Qwen 3.6 mit 14.
- Engine → Sprachmodelle zeigt beim Tutor-Modell, wie viel Kontext und wie viele Quellen es fasst.

## 1.41.0 – 2026-10-31
### New
- Engine → Sprachmodelle: Gemma 4 26B und Qwen 3.6 27B zum Dazuladen; Abwählen löscht sie wieder von der Festplatte.
- Modell für den Tutor wählbar; Kontext je Modell so bemessen, dass alles in die 24 GB einer RTX 3090 passt.
### Change
- Tutor reiht sich in die Gemma-Warteschlange ein und gibt vorher den Docling-Speicher frei; läuft gerade eine Umwandlung, antwortet das kleine Modell und sagt es dazu.

## 1.40.1 – 2026-10-31
### Change
- Tutor: Relevanz gilt als Hinweis auf den Wortlaut, nicht auf die Erklärung; steht die eigentliche Herleitung in einer schwächer bewerteten Quelle, nutzt Gemma sie.

## 1.40.0 – 2026-10-31
### Change
- Tutor: der Reranker bestimmt, wie viele Stellen mitgehen (8 bis 20 aus 40 Kandidaten); was weit unter dem besten Treffer liegt, bleibt draußen.
- Tutor: jede Quelle trägt ihre Relevanz (hoch, mittel, niedrig), Gemma stützt sich auf die hohen und nutzt niedrige nur ergänzend.

## 1.39.0 – 2026-10-31
### New
- Begriffsnetz: Gemma erfasst je Kapitel die Fachbegriffe, ihre Erklärung und worauf sie aufbauen; gleiche Begriffe aus verschiedenen Heften sind ein Eintrag.
- Bibliothek: „Begriffe erfassen“ im ⋯-Menü; läuft im Hintergrund und wartet, solange Umwandlung oder Hörbuch die Grafikkarte brauchen.
- Gemma-Anweisung „Begriffsnetz“ lässt sich in den Einstellungen anpassen.
- Tutor folgt dem Begriffsnetz bis zur dritten Ebene: Grundlagen der gefragten Begriffe kommen als Quellen („Grundlage: …“) und als Begriffskette mit, damit Gemma von unten herleiten kann.
- Zusammenhänge: Ansicht „Begriffe“ mit Erklärung, Fundstellen (★ erklärt), „Baut auf“ und „Gebraucht für“, Suche und JSON-Export.

## 1.38.0 – 2026-10-31
### New
- Tutor nutzt die Zusammenhänge wie ein Gedächtnis: die besten Treffer holen passende Stellen aus verwandten Kapiteln anderer Hefte dazu, der Reranker entscheidet; solche Quellen tragen den Hinweis „über Zusammenhang“.

## 1.37.0 – 2026-10-31
### New
- Tutor: ein Reranker (bge-reranker-v2-m3, lädt einmalig rund 2 GB) sortiert die gefundenen Stellen nach Relevanz, bevor Gemma antwortet.
### Change
- Tutor: kurze Nachfragen suchen zusammen mit der vorigen Frage, damit „und wie berechnet man die?“ die richtigen Stellen findet.

## 1.36.0 – 2026-10-31
### New
- Eigene Stimmen: jede Stimmprobe lässt sich mit jeder Engine anhören, die sie klonen kann (▶ F5, ▶ Qwen, ▶ TADA), zum direkten Vergleich.
- Stimmproben und Qwen-Designs gibt es jetzt auch auf Spanisch, mit spanischem Probetext.
### Change
- Eigene Stimmen: Ausblenden, Bearbeiten, Löschen und Originalaufnahme liegen im ⋯-Menü.
### Fix
- Beim Hochladen einer Stimmprobe lässt sich die Sprache wählen; bisher wurde jede als Deutsch angelegt.

## 1.35.0 – 2026-10-31
### New
- Formeln aus der Texterkennung werden repariert: fehlende Gleichheitszeichen aus der PDF-Textebene, zerlegte Ziffern und Wörter; Unsicheres wird als „[Formel unsicher erkannt]“ markiert.
- Tutor: die besten Treffer kommen mit ihren Nachbarabschnitten, damit Definitionen und Herleitungen nicht an der Abschnittsgrenze abreißen.
### Change
- Tutor weist auf unsicher erkannte Formeln hin, statt sie ungeprüft zu übernehmen.
### Fix
- Mathe-Zeichen aus dem Symbol-Font (z. B. =, π, ∈, ℝ, ℕ) gehen bei der Umwandlung nicht mehr verloren.
- Persönliche Fußzeile mit Name und Matrikelnummer, Einsende-Formular und Hinweisseiten landen nicht mehr in Kapiteln, Hörbuch und Suche.

## 1.34.1 – 2026-10-31
### Fix
- Der einmalige Nachtrag für Vorwort und Einleitung legt seine Markierung neben die Datenbank und bricht nicht mehr ab, wenn der Ordner fehlt.

## 1.34.0 – 2026-10-31
### New
- F5-TTS spricht auch Englisch (Originalmodell, lädt beim ersten englischen Auftrag); eigene Stimmproben gehen in Deutsch, Spanisch und Englisch.
- Vorlage-Stimmen für Spanisch (Lucía, Tux) und Englisch (Clara, Arthur), je weiblich und männlich, frei lizenziert.

## 1.33.0 – 2026-10-31
### New
- Einstellungen → Hörbuch: Standardstimme je Sprache (Deutsch, Englisch, Spanisch) und eine gemeinsame Stimmlage weiblich oder männlich.
- F5-TTS spricht Spanisch (Modell F5-Spanish, lädt beim ersten spanischen Auftrag); Stimmproben lassen sich als Español anlegen.
### Change
- Hörbuch-Lauf mit „Standardstimme je Sprache“: jedes Buch bekommt die Stimme seiner Sprache.
- Lange fremdsprachige Passagen werden in Stücke geteilt, die die Stimme verträgt.
- Ohne eigene Wahl am Heft liest die Standardstimme der zweiten Sprache; „Hauptstimme liest alles“ bleibt wählbar.
- Qwen bekommt bei Spanisch, Französisch, Italienisch und Portugiesisch die richtige Sprache statt Englisch.

## 1.32.2 – 2026-10-31
### Fix
- Bricht die Verbindung zur Stimme ab (Neustart), wird das Stück nach kurzer Pause einmal wiederholt.
- Gemma mit leerer Antwort oder Ollama-Absturz: neuer Versuch, notfalls in kleineren Stücken, statt das Kapitel unbearbeitet vorzulesen.
- Hörbuch-Lauf stürzt nicht mehr ab, wenn der Abschluss geschlossen wird, während noch ein Schritt läuft.
- Kapitel ohne Text werden übersprungen statt als Fehler gezählt; drei davon brachen bisher das ganze Hörbuch ab.
- Textstücke ohne Buchstaben (nur Satzzeichen) gehen nicht mehr an die Stimme, F5 lehnte sie ab.

## 1.32.1 – 2026-10-30
### Change
- Log: ffmpeg-Fortschritt nur noch alle 10 Sekunden, Modell-Hinweis von Gemma nur einmal.
### Fix
- Belegter Port beim Dienststart: klare Anleitung statt Docker-Meldung, mit Hinweis auf Docker Desktop.
- Erkanntes Vorwort und Einleitung sind fürs Hörbuch wieder vorausgewählt, auch bei schon umgewandelten Heften.
- Hängt Gemma in einer Wiederholung fest, versucht die App es erneut und in kleineren Stücken, statt das ganze Kapitel unbearbeitet vorzulesen.

## 1.32.0 – 2026-10-30
### New
- Jede Verbindung nennt die gemeinsamen Fachbegriffe (Export und Tooltip in der Grafik).
- Zusammenhänge: Ansicht „Themen“ zeigt, welche Kapitel welcher Hefte dasselbe behandeln, benannt nach gemeinsamen Fachbegriffen.
### Change
- Zusammenhänge: nur noch die stärksten Verbindungen des Moduls (relative Schwelle statt fester 0,5).
- Zusammenhänge: Zusammenfassungen zählen zu ihrem Kapitel statt als eigene Knoten.
### Fix
- Tabellenzeilen wie „1111 1110.“ werden nicht mehr als Kapitelüberschrift erkannt.

## 1.31.0 – 2026-10-30
### New
- Aussprache-Liste: Häkchen „geprüft“, Gemma lernt aus geprüften Einträgen und schreibt neue Wörter nach demselben Muster.
- Aussprache-Liste: ✨ lässt Gemma die Aussprache eines Worts vorschlagen, „Heft durchsuchen“ sammelt Anglizismen eines ganzen Hefts.
- Geprüfte Einträge lassen sich kopieren, um sie später als Standard in die App zu übernehmen.
### Change
- Abkürzungen werden mit deutschen Buchstabennamen gesprochen („Teh Teh Ess“ statt „T T S“).
- F5-TTS bekommt kürzere Abschnitte und etwas mehr Zeit je Abschnitt; F5-Kapitel werden beim nächsten Lauf einmal erneuert.
- Hörproben der Aussprache mit 1 s Stille davor und danach.
### Fix
- F5-TTS verschluckt am Anfang und Ende von Abschnitten keine Silben mehr.

## 1.30.0 – 2026-10-30
### New
- Hörbuch spricht Passagen der zweiten Sprache mit eigener Stimme (z. B. Thorsten für Deutsch, Dora für Spanisch); Gemma markiert sie, die App prüft, dass kein Wort verändert wurde.
- Neue Gemma-Anweisung „Sprachen markieren“, in den Einstellungen bearbeitbar.
- Zweisprachige Lehrbücher: im Bearbeiten-Dialog „Zweite Sprache im Buch“ (Spanisch, Englisch), im Hörbuch-Reiter die Stimme dafür.
### Change
- Bei zweisprachigen Büchern lässt die Kapitel-Bereinigung die Fremdsprache unverändert.

## 1.29.0 – 2026-10-30
### New
- Aussprache-Liste: ▶ neben jedem Eintrag spielt die Aussprache sofort vor, mit wählbarer Teststimme.
- Sprachen (Einstellungen → Stimmen): Kokoro lädt Englisch und Spanisch auf Knopfdruck (~340 MB), Qwen spricht beide von Haus aus.

## 1.28.0 – 2026-10-30
### New
- Aussprache-Liste für deutsche Stimmen (Einstellungen → Stimmen), z. B. „PageMentor → Pejdsch-Mentor“; greift vor jeder Sprachausgabe.
- Versionsstempel für Gemma-Fassung, Intro und Kapitel-Audio: Neue Anweisungen, Aussprache, Stimme oder Tempo erneuern beim nächsten Lauf nur die veralteten Teile, ohne vorher etwas zu löschen.
### Change
- Gemma schreibt im Intro Abkürzungen aus und setzt Anglizismen in deutsche Lautschrift; Personennamen bleiben.
- Kapitel-Anweisung: Anglizismen ohne deutsche Übersetzung in deutscher Lautschrift statt widersprüchlicher Regeln.
- Neue Hörbuch-Fassung ersetzt die alte in Audiobookshelf statt ein zweites Buch anzulegen; der Hörbuch-Lauf lädt nur hoch, wenn sich etwas geändert hat.
### Fix
- Intro löst Titel wie „Prof. Dr.-Ing.“ auf (vorher nur in Kapiteln, „Dr.-Ing.“ gar nicht).

## 1.27.0 – 2026-10-30
### New
- Gemma-Anweisungen in den Einstellungen bearbeitbar (KI → Gemma-Anweisungen), mit Knopf zurück zum Original und Hinweis, wenn ein Update das Original geändert hat.
### Change
- Gemma setzt im Intro Satzzeichen für Pausen; fehlende Punkte am Zeilenende ergänzt die App selbst.
- Intro beginnt mit 1,5 s Stille und spricht Zeile für Zeile mit Pause dazwischen.

## 1.26.1 – 2026-10-30
### New
- Hörbuch-Lauf: Reihenfolge der Bücher vor dem Start und für wartende Bücher in der Kopfzeile änderbar.
- Hörbuch-Lauf wahlweise Heft für Heft (Standard) oder Schritt für Schritt.
### Change
- Kästchen in der Bibliothek größer, die ganze Kästchen-Spalte der Zeile ist klickbar; Regel im Styleguide.

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
