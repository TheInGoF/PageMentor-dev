# PageMentor: Hilfe zum Studium in einer App

Kurzanleitung für den Alltag mit PageMentor als Studien-App. Alles läuft auf deinem
PC, die Daten liegen in `Dokumente\PageMentor`.

## Die fünf Bereiche

| Bereich | Wofür |
|---|---|
| **Start** | Nächste Prüfung mit Countdown und was bis dahin offen ist, dazu vier Kennzahlen |
| **Plan** | Leistungen nach Monaten, Prüfungstermine, CP und Notenschnitt, Lernzeit unter *Fortschritt* |
| **Module** | Je Modul: Übersicht, Dokumente, Material, Üben, Hören, Zusammenhänge |
| **Bibliothek** | Alle PDFs, Hochladen, Stapel-Import, Fälle ohne Modul |
| **Tutor** | Fragen über alle Hefte oder ein Modul, Antworten mit Quelle und Seite |

Einstellungen (Zahnrad) und Diagnose bleiben oben rechts.

## Umstieg vom Studium Maker

1. **Einstellungen → Allgemein → Übernahme aus dem Studium Maker.**
2. Ordner wählen (den Studium-Maker-Ordner mit `studienplaner.html`, `30_data`,
   `20_module`, `30_trainer`, `scripts/module_map.json`).
3. **Probelauf**: Der Bericht zeigt, was neu, aktualisiert oder übersprungen wäre.
   CP und Notenschnitt sollten wie im alten Planer sein.
4. Hinweise lesen (z. B. Kürzel, die im Katalog fehlen, oder fehlende Kataloge).
5. **Jetzt übernehmen.** Ein zweiter Lauf legt nichts doppelt an.
6. Bereits umgewandelte Hefte: **Bibliothek → Stapel-Import**, Ordner mit den PDFs
   angeben und als zweiten Ordner `10_temp/md`. Dann wird das vorhandene Markdown
   übernommen statt neu umgewandelt.
7. Wenn alles da ist, kann der Studium-Maker-Ordner ins Archiv. PageMentor liest ihn
   danach nicht mehr.

## Ein Heft vom PDF bis zur Übung

1. **Hochladen** (oder Stapel-Import) und *Extrahieren*. Docling wandelt um, Formeln
   werden als LaTeX erkannt.
2. Die App ordnet das Heft nur mit Beleg einem Modul zu (Kürzel oder Heft-Präfix auf
   dem Dokument). Sonst steht es unter *Ohne Modul* mit Vorschlag und Knopf *Zuordnen*.
3. Zeigt die Karte *Qualität prüfen*, lohnt ein Blick ins PDF (z. B. verlorene Formeln).
4. **Modul → Material → Material aus Dokumenten erzeugen**: Merksätze und Formeln aus
   Heften, Aufgaben aus Klausuren. Unsichere Einträge stehen unter *Zu prüfen*: gegen
   die Quelle lesen, korrigieren, abhaken.
5. **Hören & Karten**: Merksätze und Formeln als Hörbuch-Kapitel und Lernkarten.
6. **Üben**: Aufgabentrainer (wenn vorhanden), Lernkarten, Probeklausuren. Übungszeit
   wird automatisch als Lernzeit gebucht.

## Stimmen

**Kokoro** ist immer dabei und Standard: Martin und Kerstin, schnell, auf dem Prozessor.
Weitere Engines wählst du unter **Einstellungen → Engine → Stimmen-Engines**:

| Engine | Kann | Braucht |
|---|---|---|
| Qwen3-TTS | Vorgabe-Stimmen, Stimmen aus Beschreibung, Klonen | Grafikkarte, ca. 12 GB Download |
| F5-TTS | Klonen deutscher Aufnahmen | Grafikkarte, ca. 9 GB |
| TADA | Klonen deutscher Aufnahmen | Grafikkarte, ca. 10 GB, Hugging-Face-Token mit Llama-3.2-Freigabe |

**Eigene Stimmen** unter **Einstellungen → Stimmen & Hörbuch → Eigene Stimmen**: eine
Aufnahme von 3–10 s mit Transkript hochladen, Sprache Deutsch. Qwen, F5 und TADA klonen
daraus. Im Hörbuch-Tab wählst du dann Engine und Stimme.

## Wissensdatenbank

Im Datenordner `Dokumente\PageMentor` liegen zwei Ordner dafür:

| Ordner | Wofür |
|---|---|
| `Import` | PDFs einfach hineinlegen (Unterordner erlaubt). Die App liest den Ordner beim Start und alle zwei Minuten ein. Fertiges wandert nach `Import\Erledigt`, Doppeltes nach `Import\Dubletten`. |
| `Wissensdatenbank` | Je Dokument ein Ordner mit Markdown (Formeln als LaTeX, Kopfdaten mit Modul) und den Bildern unter `bilder\`. Lesbar für andere Programme. |

**Dubletten kosten keine Rechenzeit.** Vor Docling und KI wird geprüft, ob die gleiche Datei
(Fingerabdruck) oder der gleiche Inhalt (Textvergleich, ab 90 % gleich) schon in der Bibliothek
ist. Bei Scans ohne Textebene geht der Textvergleich erst nach der Texterkennung, aber noch vor
Kapiteln, Embeddings und Material.

**Docling arbeitet in der höchsten Stufe:** Formeln als LaTeX (auch als Bild eingebettete),
Tabellen genau, Code als Text, Bilder werden eingeordnet und kurz beschrieben. Diagramme in
Datenpunkte zu übersetzen ist abschaltbar (**Einstellungen → KI → Umwandlung der PDFs**,
standardmäßig aus): Es braucht 5–10 GB Grafikspeicher zusätzlich, bei vollen Karten lagert
Windows aus und die Umwandlung wird extrem langsam. Die nötigen Zusatzmodelle lädt die App
einmalig beim Start der Engine; der Selbsttest zeigt sie als „Docling-Modelle“.

- **Stapel-Import** in der Bibliothek: ganzen Ordner einreihen, auf Wunsch nur nachts
  (22–6 Uhr). Pausieren und Fortsetzen jederzeit, ein Absturz kostet nichts.
- **Literatur** als eigener Typ, auch ohne Modul.
- **Einstellungen → KI-Modelle → Wissensdatenbank**: Prüffragen mit bekannter Fundstelle
  anlegen und die Trefferquote messen. Erst wenn sie stimmt, ist der Tutor verlässlich.
- **Modul → Zusammenhänge**: ähnliche Kapitel aus verschiedenen Heften.

## Cloud-Hilfe (optional)

Standardmäßig aus. Einschalten unter **Einstellungen → KI-Modelle → Cloud-Hilfe**, nur
mit hinterlegtem Claude- oder OpenAI-Schlüssel. Dann gibt es:

- ☁ am Katalog-Eintrag: fachliches Lektorat, Ergebnis *Übernehmen* oder verwerfen
- *Rezepte bilden mit Cloud* im Material
- *Zweite Meinung* unter einer Tutor-Antwort
- *Diagnose* für Fehlversuche der lokalen KI

Vor jedem Versand zeigt ein Dialog genau, welcher Text an wen geht. Ohne Klick auf
*Senden* verlässt nichts den PC. Jede Sendung steht im Protokoll.

## Durchlauf nach dem Update (Checkliste)

Einmal komplett durchspielen, Auffälligkeiten mit Screenshot und Diagnose-Paket melden:

- [ ] App startet im eigenen Fenster, Engine-Selbsttest grün
- [ ] Studium-Maker-Import: Probelauf, Bericht plausibel, CP und Schnitt wie im alten Planer
- [ ] Plan: Termine, Status ändern, eine Klausur verschieben (Vorschau prüfen)
- [ ] Neues Heft hochladen: Zuordnung, Qualitätshinweis, Kapitel
- [ ] Material erzeugen für dieses Heft, unsichere Einträge prüfen und abhaken
- [ ] Hören & Karten: Lernkatalog anhören (Formeln verständlich?), Karten lernen
- [ ] Aufgabentrainer öffnen, Schritte aufdecken, Heft-Verweis springt ins Heft, Selbsttest grün
- [ ] Tutor: Frage zu einer Formel, Antwort nennt Quelle und Grep-ID
- [ ] Stapel-Import mit wenigen Heften, Restzeit plausibel
- [ ] PDF in `Import` legen: wird eingelesen, landet in `Erledigt`, Ordner in `Wissensdatenbank` mit Bildern
- [ ] Dieselbe PDF noch einmal in `Import`: landet in `Dubletten`, ohne Umwandlung
- [ ] Hörbuch-Tab: Kokoro ist vorausgewählt, Martin und Kerstin klingen sauber
- [ ] Prüffragen anlegen und Trefferquote messen
- [ ] Optional: Cloud-Hilfe einschalten, Vorschau ansehen, einmal senden
