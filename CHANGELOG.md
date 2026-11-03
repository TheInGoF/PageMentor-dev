# Changelog

Je Version: **New** (neu), **Change** (geändert), **Fix** (behoben). Kurze Sätze, innerhalb der Gruppe alphabetisch.
Der Windows-Build übernimmt den Abschnitt der Version als Release-Text.

## 1.124.0 – 2026-11-03
### New
- „Alles neu starten“ in Einstellungen → Engine → Wartung: hält alle Dienste an, beendet die Engine-Umgebung und öffnet PageMentor neu.

### Change
- Nach jedem Laden der Programmpakete steht im Protokoll, welcher Paketstand je Dienst läuft.

### Fix
- Programmpakete laden fragt immer alle Pakete nach dem neuesten Stand; vorher blieb ein Paket alt, das beim letzten Laden auf ghcr.io noch nicht neu gebaut war.

## 1.123.0 – 2026-11-03
### Fix
- Beim Start der Dienste werden Container, die noch auf einem älteren Paket laufen, mit dem geladenen neuen Paket neu angelegt; das gilt auch für „Programmpakete laden“ und den automatischen Abgleich.

## 1.122.0 – 2026-11-03
### Change
- Nach „Engine aktualisieren“ steht im Protokoll, welcher Paketstand je Dienst läuft.

### Fix
- „Engine aktualisieren“ legt die Dienste neu an; vorher startete eine Stimme wie Qwen weiter aus dem alten Container, obwohl das neue Paket schon geladen war.

## 1.121.0 – 2026-11-03
### Fix
- „Engine aktualisieren“ lädt alle Programmpakete neu, auch wenn der Paketstand gleich aussieht; vorher blieb ein Paket alt, das beim letzten Laden noch nicht neu gebaut war.
- Qwen-Batching hält sich sofort an die 30-Minuten-Pause nach einem Fehler, nicht erst ab der nächsten Einheit.

## 1.120.0 – 2026-11-03
### Fix
- Qwen-Batching pausiert nach einem gescheiterten Durchgang 30 Minuten, statt bei jedem Stück erneut Rechenzeit zu verlieren.
- Qwen-Batching scheiterte am Ende jedes Durchgangs beim Umwandeln in Audio; das Umwandeln läuft jetzt Stück für Stück, das Erzeugen bleibt gemeinsam.

## 1.119.0 – 2026-11-03
### Change
- Leistungsanzeige misst ab dem Start der App dauerhaft im Hintergrund; beim Öffnen sind die letzten 15 Minuten schon da.

## 1.118.0 – 2026-11-03
### New
- Fortschritt zeigt Qwen-Durchgänge mit mehreren Stücken an, z. B. „Stück 7 und 8 von 12 · 2 gleichzeitig“.
- Lernhörbuch und Sprachlern-Hörbuch sprechen mit eigener Qwen-Stimme ebenfalls mehrere Stücke in einem Durchgang, wenn „Abschnitte gleichzeitig“ eingestellt ist.

## 1.117.0 – 2026-11-03
### Change
- „GPU zurücksetzen“ steht jetzt auf der Engine-Seite unter Wartung.
- Qwen-Einstellung „Abschnitte gleichzeitig“ steht jetzt in den Qwen-Experteneinstellungen bei den Reglern.
- Qwen-Experteneinstellungen ohne Arbiter-Adresse und API-Key; die Engine läuft immer auf diesem PC.

## 1.116.0 – 2026-11-03
### Change
- Cover-Auswahl im Hörbuch-Reiter: „Als Standard für alle Hefte“ macht die gewählte Vorlage zum globalen Standard.

## 1.115.0 – 2026-11-03
### New
- Qwen spricht auf Wunsch mehrere Abschnitte einer eigenen Stimme in einem Durchgang (Engine-Seite, 2 bis 4, Standard aus); schlägt ein Durchgang fehl, spricht die App die Abschnitte einzeln.

## 1.114.0 – 2026-11-02
### New
- Standard-Cover in Einstellungen → Stimmen & Hörbuch wählbar, mit Vorschau am zuletzt hochgeladenen Heft; gilt für alle Hefte ohne eigene Wahl.

### Change
- Im Hörbuch-Reiter setzt „Standard der Einstellungen verwenden“ die Cover-Wahl eines Hefts zurück.

## 1.113.0 – 2026-11-02
### Change
- Lernhörbuch und Sprachlern-Hörbuch zeigen, mit welcher Stimme die Einheiten gesprochen werden.

### Fix
- Lernhörbuch und Sprachlern-Hörbuch übernehmen die im Hörbuch-Reiter gewählte Stimme; „Aktualisieren“ spricht die Einheiten damit neu und behält die Skripte.

## 1.112.0 – 2026-11-02
### New
- Module haben eine Wissenschaft: Qwen ordnet sie in der Wissenspflege zu, auch neue Module; im Bearbeiten-Dialog lässt sie sich von Hand wählen oder an Qwen zurückgeben.
- Jede Wissenschaft hat eine Farbe, verwandte Fächer liegen im selben Farbraum; die Modulkarte zeigt Wissenschaft und Farbe, eine selbst gewählte Farbe bleibt.

## 1.111.0 – 2026-11-02
### Change
- Leistungsanzeige mit logarithmischer Zeitachse über 15 Minuten: rechts die letzten Sekunden breit, nach links gedrängt, mit Marken bei 10 s, 1 min und 5 min.

## 1.110.0 – 2026-11-02
### Change
- Hörbuch-Kapitel zeigen, mit welchem Modell und wann der Text bereinigt wurde, sowie Stimme, Engine und Zeitpunkt des Audios.

### Fix
- Ein Wiederholungslauf setzt den Zeitpunkt des Kapitel-Audios neu statt das alte Datum zu behalten.

## 1.109.0 – 2026-11-02
### New
- Diagnose hat den Reiter Leistung: CPU, Arbeitsspeicher, GPU-Last, Grafikspeicher, GPU-Temperatur, Leistungsaufnahme und Platte mit Verlauf der letzten 5 Minuten.

## 1.108.0 – 2026-11-02
### New
- Zugriff im Heimnetz: unter Einstellungen → Allgemein lässt sich die App für Laptop oder Handy im selben Netz öffnen. Passwort setzen, Schalter an, angezeigte Adresse im Browser öffnen und anmelden; das Fenster am PC braucht keine Anmeldung. Der Port wird sofort umgeschaltet, ein Knopf legt die Regel in der Windows-Firewall an (Windows fragt nach Administratorrechten). Andere Geräte sehen nur die Oberfläche, alles läuft weiter auf dem PC; die Heimnetz-Einstellungen selbst sind nur am PC änderbar.

## 1.107.1 – 2026-11-02
### Fix
- Stapel-Import: Ordner werden in fester Reihenfolge gelesen (erst Dateien nach Name, dann Unterordner). Vorher hing es vom Dateisystem ab, welche von zwei gleichen Dateien als Dublette galt; die Prüfungen auf GitHub scheiterten daran.

## 1.107.0 – 2026-11-02
### Change
- Hörbuch-Cover: feste Maße für ruhige Regale in Audiobookshelf. Der Kopfhörer ist auf jedem Cover gleich groß und sitzt an derselben Stelle, der Titel steht in fester Schriftgröße mit höchstens drei Zeilen, längere Titel enden mit „…“. Der Modulname entfällt.

## 1.106.0 – 2026-11-02
### New
- Hörbuch-Cover: drei eigene Vorlagen mit PageMentor-Logo, Kopfhörer, Modulname, Hefttitel und der Art des Hörbuchs (Hörbuch, Lernhörbuch, Sprachlern-Hörbuch). Farbfeld in der Modulfarbe ist Standard, dazu Hell und Zweigeteilt mit der Originalseite oben; die Originalseite bleibt wählbar. Auswahl mit Vorschau je Heft im Hörbuch-Tab unter den Einstellungen für alle Hörbücher. Lange Titel schrumpfen stufenweise, Wörter werden nur zur Not getrennt; Buch- oder Quadratformat folgt der Bibliothek in Audiobookshelf.
### Fix
- Lernhörbuch: M4B und Einheiten bekommen jetzt ein Cover; der alte Pfadsucher fand die gerenderte Seite nicht.

## 1.105.0 – 2026-11-02
### Change
- Kopfzeile: eine Pille statt drei. Die Warteschlange zeigt oben die Aufträge mit ↑ ↓ und ⋯, darunter den Hörbuch-Stapel mit seinen Büchern (Umsortieren, Fortsetzen, Abbrechen) und die Wissenspflege mit Jetzt starten und Abbrechen. Die Pille nennt das Laufende, sonst die Übernahme, den Stapel oder die Wissenspflege.

## 1.104.0 – 2026-11-01
### New
- Wortprüfung: Lautschriften, die Gemma bei der Bereinigung in den Kapiteltext geschrieben hat, werden aus dem Vergleich mit dem Original herausgelesen, von Gemma bestätigt und als offene Einträge in die Ausspracheliste gestellt. Die Wortprüfung hört sie danach ab. Je Lauf bis zu 20 Kapitel, durchgesehene Kapitel werden gemerkt.

## 1.103.0 – 2026-11-01
### New
- Wortprüfung: Die Wissenspflege spricht offene Einträge der Ausspracheliste mit der deutschen Standardstimme im Satz „Das Wort heißt: …“, hört sie mit Whisper ab und vergleicht. Hört Whisper das Originalwort, ist der Eintrag erledigt; sonst schlägt Gemma eine andere Schreibweise vor, bis zu drei Runden. Was offen bleibt, zeigt in der Liste, was Whisper gehört hat. Läuft nach dem Begriffsnetz, nur mit Whisper.

## 1.102.0 – 2026-11-01
### Fix
- Begriffsnetz: Qwen lief im Denkmodus, brauchte das ganze Token-Budget auf und lieferte leere Antworten. Die Erfassung läuft jetzt ohne Denkmodus, wie das Lernhörbuch.
- Begriffsnetz: Eine leere Antwort gilt nicht mehr als fertig. Vorher wurde so ein Kapitel ohne Begriffe gestempelt und verlor, was es hatte. Das Netz wird einmal komplett neu gebaut.

## 1.101.0 – 2026-11-01
### Fix
- Lernhörbuch-Intro: Jede Leerzeile im Text wird zu einer Sekunde Pause. Vorher lagen nur 0,3 Sekunden zwischen Titelblock und Autor.

## 1.100.0 – 2026-11-01
### Fix
- Intro: Versionsziffern im Modellnamen stehen als Zahlwort, „Qwen drei Punkt sechs“ und „Gemma vier“, damit die Stimme nicht über „3.6“ stolpert.

## 1.99.0 – 2026-11-01
### Change
- Begriffsnetz: Die Wissenspflege nimmt Qwen 3.6, wenn es geladen ist, sonst Gemma 4 26B, sonst das Standardmodell. Das Modell steht im Stempel der Kapitel: Mit einem anderen Modell gelten sie als offen, das Netz entsteht aus einem Guss.

## 1.98.0 – 2026-11-01
### Change
- Hörbuch-Bereinigung: Gemma schreibt englische Wörter, Anglizismen und englische Eigen- und Produktnamen immer in deutscher Lautschrift, auch geläufige Lehnwörter. Abkürzungen, die nicht als Wort gesprochen werden, mit deutschen Buchstabennamen („Teh Teh Ess“), keine englischen Auflösungen in Klammern.
- Hörbuch-Bereinigung: Die geprüften Einträge der Ausspracheliste gehen nach Art gegliedert in die Anweisung (Abkürzungen, Wörter und Namen) mit benanntem Schema, damit Gemma die Tendenz auf Wörter überträgt, die nicht in der Liste stehen.

## 1.97.0 – 2026-11-01
### Change
- Intro: Das Modell heißt sprechbar „Qwen 3.6“ oder „Gemma 4“ statt „qwen3.6:27b“; die Ausspracheliste macht daraus „Kwenn“ und „Dschemma“.
- Lernhörbuch-Intro ohne den Satz „Wenn eine Frage kommt, halte kurz an …“.

## 1.96.0 – 2026-11-01
### Change
- Intro-Vorlage neu gegliedert: Modul als eigene Zeile, dann „Hörbuch: Titel“ bzw. „Lernhörbuch: Titel“ oder „Sprachlern-Hörbuch: Titel“, dann Autor. Die Lernhörbücher nennen dazu „Zum Lernen aufbereitet durch …“ mit dem Modell, das die Einheiten geschrieben hat, sonst „KI“.

## 1.95.0 – 2026-11-01
### Fix
- Audiobookshelf: Beim erneuten Hochladen werden alle alten Fassungen des Buchs entfernt, nicht nur ein eindeutiger Treffer. Jeder Upload trägt ein Kennzeichen als Tag, darüber findet der nächste Upload die alte Fassung auch nach Umbenennen. Nach dem Upload gilt der neueste Eintrag als der eigene, mit bis zu 20 Sekunden Wartezeit auf den Scan.

## 1.94.0 – 2026-11-01
### Change
- Intro: Die Vorlage nennt vor dem Hefttitel den Modulnamen („Hörbuch: Elektrotechnik, Gleichstrom.“), beim Original wie bei Lernhörbuch und Sprachlern-Hörbuch.
- Lernhörbuch-Intro beginnt mit einer Sekunde Stille statt 0,8 Sekunden. Das Original-Intro hat 1,5 Sekunden.

## 1.93.0 – 2026-11-01
### New
- Warteschlange: Umwandlungen, Hörbücher und Lernhörbücher, die beim Beenden offen waren, stehen nach dem Neustart als „unterbrochen“ in der Kopfzeile. „Fortsetzen“ startet sie in alter Reihenfolge, jeder macht nur, was noch fehlt; „Verwerfen“ räumt sie weg. Stapel-Bücher und Einzelkapitel sind ausgenommen, der Stapel merkt sich seine Bücher selbst.

## 1.92.0 – 2026-11-01
### New
- Warteschlange: ⋯ entfernt einen Eintrag, auch einen laufenden; der Auftrag wird abgebrochen, Fertiges bleibt.
- Warteschlange: Umwandlung, Hörbuch und Lernhörbuch stehen in einer echten Reihenfolge, wartende Einträge lassen sich mit ↑ ↓ verschieben. Das Lernhörbuch gibt die Grafikkarte zwischen zwei Einheiten frei, ein vorgezogener Auftrag kommt dazwischen.
### Fix
- Umwandlung entlädt ein geladenes Sprachmodell, bevor Docling startet, wie die Wissenspflege. Vorher lag Docling neben Qwen oder Gemma im Grafikspeicher und kam nicht voran.

## 1.91.0 – 2026-11-01
### New
- Gehirn: Kapitel wählen, dann leuchten seine Begriffe und ihre Grundlagen bis Ebene 3; die Liste steht rechts.
- Gehirn: Schalter „nur erklärte“ blendet Begriffe aus, die nur benutzt werden.

## 1.90.0 – 2026-11-01
### New
- Gehirn: Schlagwortsuche. Beim Tippen werden Treffer grün, ihre Nachbarn hellgrün, die Treffer stehen rechts zum Anklicken.
### Change
- Gehirn: Begriffe hängen an ihrem Heimat-Heft. Herausgezoomt stehen Module und Hefte als Themen über den Wolken, hineingezoomt die Begriffe.
- Gehirn: Keine Modulfarben mehr, alle Punkte grau; Pfeile zur Grundlage sind immer sichtbar, ungesicherte Verbindungen gestrichelt.

## 1.89.0 – 2026-11-01
### Change
- Tutor: Grundlagen-Begriffe und ihre Kapitel kommen nur noch über gesicherte Verbindungen des Begriffsnetzes in die Antwort.

## 1.88.0 – 2026-11-01
### New
- Begriffsnetz: Eine Verbindung gilt als gesichert, wenn sie in zwei Kapiteln vorkommt, die Grundlage im Heft vorher erklärt wird oder aus einem anderen Heft stammt. Gegenseitige Paare behalten nur die Richtung zur früher erklärten Grundlage. Ungesicherte Verbindungen sind im Gehirn gestrichelt.
### Change
- Begriffsnetz: Kapitel ohne Wort im Titel (Aufgabenfetzen) und Sprachhefte werden nicht mehr ausgewertet; vorhandene Einträge daraus werden beim Start entfernt.

## 1.87.0 – 2026-11-01
### Change
- Begriffsnetz: Gemma liefert je Abschnitt höchstens acht Fachbegriffe, jede Erklärung muss den Begriff definieren, „baut auf“ nur für echte Voraussetzungen (höchstens drei). Keine Allerweltswörter und keine Wortvarianten. Die Wissenspflege baut das Netz damit neu.

## 1.86.0 – 2026-11-01
### New
- Gehirn: Knopf „Alle“ zeigt das ganze Begriffsnetz statt höchstens 300 Begriffe.
### Fix
- Gehirn: Modulfarben zählen nur Module mit Begriffen. Vorher bekam ein Modul die Farbe seiner Position in der Liste aller Module, auch leerer.

## 1.85.0 – 2026-11-01
### New
- Lernhörbuch: Jede Einheit nennt am Anfang zwei, drei Lernziele („Nach dieser Einheit können Sie …“), die Zusammenfassung geht sie durch.

## 1.84.0 – 2026-11-01
### New
- Sprachlern-Hörbuch: Der Dialog kommt erst wirklich langsam (80 % Tempo, gleiche Tonhöhe), dann normal. Im Skript steht die langsame Fassung in [langsam]…[/langsam].

## 1.83.0 – 2026-11-01
### Fix
- Sprachausgabe: Ein Fehler im Sprach-Dienst steht mit Grund im Log statt nur als „Internal Server Error“.
- TADA: Der Aligner einer weiteren Sprache (etwa Spanisch für die Zweitstimme) wird nach dem ersten Start nachgeladen statt mit Fehler 500 zu scheitern.

## 1.82.0 – 2026-11-01
### Change
- Sprachlern-Hörbuch: Abgefragt wird nur, was vorher vorgestellt und nachgesprochen wurde. Längere Wendungen werden von hinten aufgebaut.
- Sprachlern-Hörbuch: Abruf in wachsenden Abständen, abwechselnd als Situation, als deutsche Bedeutung oder mit dem eigenen Namen.
- Sprachlern-Hörbuch: Je Wendung ein Satz zur Situation, die wörtliche Bedeutung und ein Hinweis zur Aussprache. Grammatik mit dem Warum.
- Sprachlern-Hörbuch: Keine Reihen derselben Wendung mit verschiedenen Namen als Füller. Dialoge nur mit Wendungen, die man in der Situation wirklich sagt.

## 1.81.0 – 2026-11-01
### Change
- Lernhörbuch: Formeln werden erst in Worten erklärt und dann einmal gesprochen; Größen heißen „Zustand eins“ statt „x i“.
- Lernhörbuch: Jede Einheit beginnt mit „Einheit N: Titel“ statt mit einem erfundenen Kursnamen.
- Lernhörbuch: Keine Verweise auf Beispiel-, Abbildungs- oder Abschnittsnummern und nicht auf das Heft; das Beispiel wird selbst erzählt.
- Lernhörbuch: Die Wiederholung entfällt ohne Hinweis, wenn es noch nichts zu wiederholen gibt.

## 1.80.0 – 2026-11-01
### Change
- Lernhörbuch: Pausen nach ihrer Aufgabe: eine Sekunde zwischen Absätzen, zwei vor einem neuen Abschnitt, sechs nach einer Frage an den Hörer, acht bei einer Rechnung. Rhetorische Fragen bekommen keine Pause.
### Fix
- Lernhörbuch: Die Pause zwischen einer Frage und ihrer Antwort dauert beim Sprechen mindestens sechs Sekunden, auch wenn das Skript weniger vorgibt.

## 1.79.0 – 2026-11-01
### Change
- Lernhörbuch: Jede Einheit beginnt mit einer Vorab-Frage, die die Zusammenfassung am Ende ausdrücklich beantwortet.
- Lernhörbuch: Von den zwei Denkfragen prüft die erste das Warum, die zweite wendet das Gelernte auf eine Alltagssituation an. Keine Frage fragt nur den eben gesagten Satz zurück.

## 1.78.0 – 2026-11-01
### Change
- Lernhörbuch: Der Prüfdurchgang rechnet jedes Zahlenbeispiel nach und gleicht es mit dem Heft ab. Absichtlich falsche Beispiele des Hefts bleiben erhalten. Die Nachrechnung steht in der Prüfnotiz.
### Fix
- Lernhörbuch: Verdrehte Zahlwörter wie „achtzigvier“ werden vor dem Sprechen zu „vierundachtzig“. Die Zahlwort-Reparatur des Original-Hörbuchs läuft auch hier.

## 1.77.0 – 2026-11-01
### New
- Gehirn lässt sich mit dem Mausrad an der Mausposition zoomen, durch Ziehen verschieben und über +, − und „Ganzes Netz“ steuern.

## 1.76.0 – 2026-11-01
### Fix
- Abbrechen einer Umwandlung beendet auch den Docling-Auftrag auf dem Server, die Grafikkarte wird frei.
- Lernhörbuch-Einheiten spielen in einem Abspieler mit Pause und Spulen statt ohne Bedienung bis zum Ende.

## 1.75.0 – 2026-11-01
### Fix
- Wissenspflege startet erst, wenn die Grafikkarte drei Minuten ruht, auch nach Testsätzen, Modelltests und Spracherkennung.

## 1.74.0 – 2026-11-01
### New
- Gehirn-Export: Begriffsnetz des gewählten Bereichs als Markdown, je Kapitel Begriffe mit Rolle, Erklärung und Grundlagen, wahlweise mit Textauszug.

## 1.73.0 – 2026-11-01
### Change
- Lernhörbuch und Sprachlern-Hörbuch nutzen den Intro-Editor des Original-Hörbuchs: Text, Gemma-Sprachfassung, Audio einzeln anhören und löschen.
- Lernhörbuch-Intro wird wie beim Original aus Gemmas Sprachfassung gesprochen.
- Vorlage des Lernhörbuch-Intros ist wie beim Original zeilenweise aufgebaut, mit Titelzusatz und „Nach dem Buch von …“.

## 1.72.0 – 2026-11-01
### Fix
- Leerlauf-Umwandlung entlädt Gemma vor Docling und gibt Docling danach frei, bevor die Begriffe beginnen.
- Leerlauf-Umwandlung wartet vor jedem Heft, bis Gemma drei Minuten ruht und kein Lernhörbuch, Stapel oder Hörbuch läuft.

## 1.71.0 – 2026-11-01
### Change
- Bibliothek zeigt bei wartenden Heften „Wartet auf Leerlauf“ oder „Metadaten fehlen“.

### Fix
- Wissenspflege wandelt auch Hefte um, deren Metadaten vor v1.66 gepflegt wurden (Autor oder Kürzel eingetragen).

## 1.70.0 – 2026-11-01
### Change
- Engine-Seite einheitlich: Klangstufen und Download-Bremse werden wie alles andere erst mit „Übernehmen“ gespeichert.

### Fix
- Testsätze deutscher Stimmen nutzen die Ausspracheliste („PageMentor“ → „Pejdsch-Mentor“).
- Testsätze werden nach Änderungen neu berechnet statt aus dem Browser-Speicher zu kommen.

## 1.69.0 – 2026-11-01
### New
- Klangstufen für F5 (Schnell 16, Standard 32, Beste 64 Schritte) unter Engine → Stimm-Engines.
- Klangstufen für TADA (Schnell, Ruhig, Beste) unter Engine → Stimm-Engines. Ruhig ist neuer Standard: weniger Rauschen, mehr Rechenschritte.
- Stimmproben zeigen ihre Länge und warnen, wenn sie für F5 zu lang sind (über 12 s schneidet F5 ab, der Text passt dann nicht mehr).
- TADA spricht jetzt auch Englisch, Spanisch, Französisch, Italienisch und Portugiesisch. Der Aligner der Sprache lädt beim ersten Satz.

### Change
- Stimm-Extraktor empfiehlt 5 bis 11 s und markiert längere Ausschnitte gelb.

## 1.68.0 – 2026-11-01
### Change
- Der früher angehängte Abschnitt „Gelernte Hinweise“ wird einmalig aus dem Hörbuch-Prompt entfernt.
- Gemma lernt aus gelösten Aussprache-Befunden jetzt in die Ausspracheliste: Der Vorschlag kommt als offener Eintrag zum Anhören und Abhaken. Der Hörbuch-Prompt bleibt unverändert.

## 1.67.0 – 2026-11-01
### New
- Ausspracheprüfung: „Rest ignorieren“ räumt die offenen Befunde eines Kapitels mit einem Klick weg.

### Fix
- Ausspracheprüfung meldet nur noch echte Abweichungen: Zahlen, Abkürzungen, buchstabierte Namen, Formelzeichen, getrennt oder zusammen geschriebene Wörter, Schreibvarianten und „unsicher“ fallen weg. Gilt auch für schon gespeicherte Befunde.

## 1.66.0 – 2026-11-01
### New
- Wissenspflege wandelt in Leerlaufpausen hochgeladene Hefte mit Docling um, sobald ihre Metadaten bearbeitet sind. So bekommen Suche und Tutor Futter.

### Fix
- Ergänzungsstrich am Zeilenende bleibt erhalten: „Signal- und Informationsverarbeitung“ statt „Signalund“.

## 1.65.0 – 2026-11-01
### Change
- Ausspracheliste in zwei aufklappbaren Gruppen „Offen“ und „Erledigt“, beide anfangs eingeklappt. Zeilen wechseln die Gruppe erst beim Speichern.

## 1.64.0 – 2026-11-01
### New
- Beim Beenden fährt PageMentor seine Engine-Umgebung herunter: WSL gibt den Arbeitsspeicher (vmmemWSL) wieder ganz frei.
- WSL gibt ungenutzten Arbeitsspeicher während des Betriebs schrittweise an Windows zurück (.wslconfig, eigene Einstellungen bleiben).

## 1.63.0 – 2026-11-01
### New
- Im M4B stehen mehrere Autoren mit Komma getrennt.
- Intros lesen mehrere Autoren mit „und“ vor („Ana Babiloni und Hildegard Ritter“).
- Mehrere Autoren (mit ; , „und“, & oder / getrennt) gehen als einzelne Autoren zu Audiobookshelf.

## 1.62.0 – 2026-11-01
### New
- Lernhörbuch-Intro lässt sich bearbeiten, auf die Vorlage zurücksetzen und einzeln neu sprechen. Danach wird nur das Hörbuch neu gebaut.

### Fix
- Einheiten ohne lernbaren Inhalt werden markiert und übersprungen, statt den Lauf abzubrechen. Sie fehlen im M4B.
- Gemma und Qwen schreiben Lernhörbücher ohne Denkmodus. Zuvor kamen leere Skripte („0 Zeichen, length“).
- Liefert das Modell zweimal kein Skript, wird die Einheit markiert und beim nächsten Lauf erneut versucht. Der Lauf geht weiter.
- Probe nimmt die erste Einheit mit Inhalt.

## 1.61.0 – 2026-11-01
### New
- Lernhörbücher lassen sich über das ⋯-Menü herunterladen, mit Zusatz im Dateinamen.

### Change
- Das Lernhörbuch-Intro nennt Titel und Autor genau mit dem Zusatz wie im M4B und in Audiobookshelf.
- Gemeinsamer Bedien-Kopf für alle drei Hörbücher: Variante wählen, Erzeugen bzw. Probe und Ganzes Heft, Fortschritt und ⋯-Menü an derselben Stelle.

## 1.60.0 – 2026-11-01
### New
- Fertige Lernhörbücher lassen sich nachträglich mit einem Knopf zu Audiobookshelf hochladen.
- Lernhörbücher bekommen ein gesprochenes Intro: Titel, nach wessen Buch, Umfang und wie man damit lernt.
- Lernhörbücher gehen mit eingeschaltetem Audiobookshelf automatisch dorthin, als eigener Eintrag neben dem Original.

### Change
- Lernhörbücher heißen „… – Lernhörbuch“ bzw. „… – Sprachlern-Hörbuch“, als Autor steht „nach dem Buch von …“.

### Fix
- Tests der Ausspracheprüfung warten unter Last lang genug.

## 1.59.0 – 2026-10-31
### New
- Gemma lernt aus gelösten Aussprache-Befunden: Nur beim grünen Haken leitet sie einen allgemeinen Hinweis ab und hängt ihn an den Hörbuch-Prompt an. Bestehender Text bleibt immer erhalten.
- Jeder gelöste Befund zeigt, was Gemma daraus gelernt hat oder dass nichts Neues dabei war.
- Neuer bearbeitbarer Prompt „Aussprache: aus Befunden lernen“.

## 1.58.0 – 2026-10-31
### New
- Aussprache prüfen (Debug) unter Stimmen: Whisper hört ein fertiges Hörbuch ab und meldet falsch gesprochene, verschluckte und unsichere Wörter.
- Befunde lassen sich anhören, mit ✓ abhaken, ignorieren oder direkt in die Ausspracheliste übernehmen (mit Gemma-Vorschlag).
- Die Warteschlange zeigt laufende Ausspracheprüfungen.

## 1.57.0 – 2026-10-31
### New
- Whisper als Zusatz-Engine (Einstellungen → Engine → Stimm-Engines): hört fertige Hörbücher ab, Grundlage für die Ausspracheprüfung.

## 1.56.0 – 2026-10-31
### New
- Die drei Hörbuch-Knöpfe zeigen „läuft · 3/12“, auch wenn gerade ein anderer Bereich offen ist.

### Fix
- Lernhörbuch zählt Einheiten ab 1 statt „Einheit 0 von 12“.
- Lernhörbuch zeigt den Fortschritt innerhalb einer Einheit: schreibt, prüft, korrigiert oder spricht (Stück x von y), mit Laufzeit und Balken.

## 1.55.0 – 2026-10-31
### Change
- Hörbuch-Aktionen (Herunterladen, Ordner, M4B, Audiobookshelf, Löschen) stehen hinter dem ⋯-Menü.
- Hörbuch-Reiter aufgeräumt: drei große Knöpfe für Original-Hörbuch, Lernhörbuch und Sprachlern-Hörbuch, darunter nur der gewählte Bereich.
- Stimme, Tempo, Zweitstimme und Stimmvergleich gelten für alle drei und sind oben zusammengeklappt.

## 1.54.0 – 2026-10-31
### New
- Warteschlange im Kopf: zeigt, was gerade auf der Grafikkarte läuft und was wartet, mit Fortschritt je Aufgabe.

### Change
- Die Ladeanzeige der Stimm-Engines ist jetzt Teil der Warteschlange.

### Fix
- Docling startet nicht mehr, solange das Lernhörbuch eine Einheit schreibt oder spricht. Das Lernhörbuch pausiert danach, bis die Umwandlung fertig ist.

## 1.53.0 – 2026-10-31
### New
- Hefte lassen sich jetzt direkt im geöffneten Modul hochladen, das Modul ist vorgewählt.
- Ladeanzeige für Stimm-Engines im Kopf: Engine startet, Modell lädt oder wird heruntergeladen, mit Fortschritt.

### Fix
- Arbiter-Test wartet auf Hintergrund-Stopps und schlägt nicht mehr zufällig fehl.

## 1.52.0 – 2026-10-31
### New
- Stimm-Extraktor: Bei eigenen Stimmen lassen sich jetzt Videos wählen. Vorschau, grobe Auswahl mit Zoom und Feinauswahl auf Hundertstel.
- Stimm-Extraktor: Der Ausschnitt wird als WAV mit je 0,5 s Stille davor und danach zur Stimmprobe.

## 1.51.0 – 2026-10-31
### New
- Gehirn im Tutor: Das Begriffsnetz aller Module als Grafik, Begriff anklicken zeigt Erklärung, Grundlagen und Fundstellen.
- Gehirn-Frage: Eine Frage lässt die Begriffe aufleuchten, die der Tutor nutzt, mit Grundlagen bis Ebene 3.

## 1.50.0 – 2026-10-31
### New
- Download-Bremse: Die App misst beim ersten Download 60 Sekunden lang die Geschwindigkeit und begrenzt Engine-Downloads danach auf 90 % davon.
- Einstellbar unter Engine: Anteil von 50 bis 100 % (aus), dazu „Neu messen“.

## 1.49.0 – 2026-10-31
### New
- Logs: „Kopieren“ legt die sichtbaren Zeilen (mit Filter, Kontext und Fehlerdetails) in die Zwischenablage.
### Fix
- Selbsttest: ein Dienst, der gerade startet und Modelle lädt (z. B. Embeddings mit dem neuen Reranker), gilt als „startet noch“ mit seiner letzten Log-Zeile, statt alle zwei Sekunden neu gestartet zu werden.

## 1.48.1 – 2026-10-31
### Fix
- Automatische Prüfungen auf GitHub wieder grün: der Testlauf installiert ffmpeg für den Lernhörbuch-Test.

## 1.48.0 – 2026-10-31
### New
- Wissenspflege, Teil 2 (Anzeige): in der Kopfzeile „Wissenspflege in 42 s“ mit Liste, was fehlt, „Jetzt starten“ und Abbrechen; im Lauf „Wissenspflege · Begriffe · 12/40“, aufgeklappt mit Heft, Kapitel und Fortschrittsbalken.

## 1.47.0 – 2026-10-31
### New
- Wissenspflege im Hintergrund, Teil 1: prüft jede Minute, ob alle Hefte Embeddings und Begriffsnetz haben, kündigt sich mit einer Minute Countdown an und holt Fehlendes Heft für Heft nach; wartet, solange Umwandlung, Hörbuch oder Lernhörbuch laufen. Abbrechen lässt sie zwei Stunden ruhen.
### Fix
- Begriffsnetz: antwortet Gemma nicht, bleibt das Kapitel offen statt leer als fertig markiert; nach drei Fehlschlägen in Folge hält der Lauf an.

## 1.46.0 – 2026-10-31
### New
- Hörbuch-Tab: Karte „Lernhörbuch“ mit Art (Sprachkurs oder Fachheft), Zielsprache, Probe der ersten Einheit und ganzem Heft, Fortschritt und Abbrechen.
- Jede Einheit lässt sich anhören; im ⋯-Menü zeigt sie Skript, Merkpunkte und die Prüfnotiz.
- Engine → Sprachmodelle: eigenes Modell für Sprachkurse und für Fachhefte wählbar, sonst der Vorschlag der App.

## 1.45.0 – 2026-10-31
### New
- Lernhörbuch, Teil 2 (Sprache): Skripte werden gesprochen, Deutsch und Fremdsprache mit eigener Stimme, [PAUSE n] als echte Stille zum Antworten und Nachsprechen.
- Je Einheit eine MP3 mit Lautheitsausgleich; das ganze Heft wird ein M4B mit einem Kapitel je Einheit und landet als „… - Lernhoerbuch.m4b“ neben dem normalen Hörbuch im Hörbücher-Ordner.
- Probe: nur die erste Einheit wird geschrieben und gesprochen, ohne M4B.
- Fertige Einheiten werden übersprungen, solange Skript, Stimmen und Tempo gleich bleiben.

## 1.44.0 – 2026-10-31
### New
- Lernhörbuch, Teil 1 (Skripte): das Heft wird als fortlaufender Text gelesen, in Lerneinheiten von einigen Minuten geteilt und je Einheit neu geschrieben, als Sprachkurs (Abrufen, Nachsprechen, Geschichte) oder Fach-Lernskript (Erklärung, Formeln in Worten, Denkfragen).
- Frühere Merkpunkte kommen in wachsenden Abständen wieder (1, 3 und 7 Einheiten zurück).
- Fachhefte: Prüfdurchgang gegen die Vorlage, gefundene Abweichungen werden korrigiert und notiert.
- Schreibt mit Gemma 4 26B (Sprachkurse) bzw. Qwen 3.6 27B (Fachhefte), wenn geladen; drei neue Gemma-Anweisungen in den Einstellungen.
### Change
- Der Hörbuch-Stapel wartet, solange ein Lernhörbuch geschrieben wird.

## 1.43.0 – 2026-10-31
### New
- Tutor zeigt, wie voll das Kontextfenster der letzten Antwort war (Token, Prozent, Farbe).
- Tutor-Gedächtnis: Runden, die aus dem Fenster fallen, werden gezielt verdichtet statt weggeworfen; Fachliches, gute Antworten sowie Fehler mit Korrektur bleiben, Abschweifungen fallen weg. Gebündelt ab drei Runden, ab 80 % Auslastung sofort.
- Gemma-Anweisung „Tutor: Gesprächsgedächtnis“ lässt sich in den Einstellungen anpassen.

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
