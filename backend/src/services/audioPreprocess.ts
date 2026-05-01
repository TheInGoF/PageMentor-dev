/**
 * Audio preprocessor.
 *
 * Prepares a chapter text for TTS — strips everything that doesn't
 * make sense spoken or that would lose listeners while driving:
 *
 *   - Expand abbreviations (z. B. → "zum Beispiel", vgl. → "vergleiche")
 *   - Verbalize numbers and units (§ 12 → "Paragraph zwölf",
 *     5 kg/m² → "fünf Kilogramm pro Quadratmeter")
 *   - Formulas in speakable form (f(x) = x² → "f von x gleich x Quadrat")
 *   - Remove or reformulate inline citations ((Müller 2023, S. 42)
 *     → either drop or "laut Müller")
 *   - Strip list markers (• – * 1. 2. 3.) — they're annoying spoken,
 *     better replaced with natural transitions
 *   - Announce code blocks and URLs sensibly
 *   - Spell out Greek letters and special characters
 *
 * Important: the content must NOT change. No omissions, no
 * rephrasing, no simplifications — only form.
 *
 * Once per chapter, then cached in `chapters.audio_text`. On
 * re-extraction via Docling all chapter rows are replaced → cache
 * naturally falls out.
 */

import { db } from "../db";
import { generate, isAvailable as llmAvailable } from "./llm";
import { expandAbbreviations } from "./germanAbbreviations";

interface ChapterRow {
  id: string;
  text: string;
  audio_text: string | null;
  audio_text_model: string | null;
  document_id: string;
}

const SYSTEM_DE = `Du bist ein Lektor, der wissenschaftliche Studientexte für die Vertonung als Hörbuch aufbereitet. Deine Aufgabe: forme den vorgelegten Text so um, dass er von einer TTS-Engine flüssig und natürlich vorgelesen werden kann — ohne den fachlichen Inhalt zu verändern, ohne Auslassungen, ohne Vereinfachungen.

================================================================
KRITISCHER FAILURE-KATALOG — diese Fehler NIE produzieren
================================================================
Diese Fehler haben in der Vergangenheit die TTS-Engine in Endlos-Schleifen
geschickt und müssen unter allen Umständen vermieden werden:

1) ABSCHNITTS- UND BEISPIEL-NUMMERN BLEIBEN ZIFFERN
   FALSCH:  "Beispiel zwei Punkt eins"
   FALSCH:  "Beispiel zwei Komma fünf"
   FALSCH:  "Abbildung drei Punkt zwei"
   RICHTIG: "Beispiel 2.1"
   RICHTIG: "Beispiel 2.5"
   RICHTIG: "Abbildung 3.2"
   Begründung: TTS spricht "2.1" korrekt aus. Verbalisierte Form mischt
   sich mit Dezimalzahlen ("zwei Komma fünf" = 2,5!) und triggert Loops,
   wenn der Marker mehrfach im Kapitel auftaucht.

2) JAHRESZAHLEN BLEIBEN ZIFFERN — NIEMALS AUSSCHREIBEN
   FALSCH:  "Maslow neunzehnhundertneunundneunzig"
   FALSCH:  "Berger zweitausendachtzehn Seite neununddreißig"
   FALSCH:  "Sprenger zweitausendvierzehn"
   RICHTIG: "Maslow 1999"
   RICHTIG: "Berger 2018, Seite 39"
   RICHTIG: "Sprenger 2014"

3) NIE ZAHLWÖRTER ZUSAMMENKLEBEN
   FALSCH:  "zweitausendelfteinundzwanzig"   (war "2011/2021")
   FALSCH:  "Seite hundertvierf"             (war "S. 104 f.")
   FALSCH:  "zwehaufachtzig"                 (war "2.80")
   FALSCH:  "Beispiel zwei Punkt zwehaufneun"
   RICHTIG: "2011 und 2021"   oder einfach "2011, 2021"
   RICHTIG: "Seite 104 und folgende"
   RICHTIG: "2.80"
   Wenn du eine Zahl nicht sauber verbalisieren kannst: ZIFFERN STEHEN
   LASSEN. Lieber eine Ziffer als ein gemashter Wortbrei.

4) "f." UND "ff." NACH SEITENZAHL = "und folgende"
   "S. 104 f."  → "Seite 104 und folgende"
   "S. 22 ff."  → "Seite 22 und folgende"
   Niemals an die Zahl anschweißen ("hundertvierf"). Niemals als nackten
   Buchstaben "f" stehen lassen.

5) META-MARKER NICHT REPETITIV WIEDERHOLEN
   Wenn das Kapitel 30 Beispiele in Folge enthält ("Beispiel 2.1",
   "Beispiel 2.2", … "Beispiel 2.30"), präfixiere NICHT jeden Eintrag mit
   "Ein Beispiel hierzu ist Beispiel zwei Punkt X". Diese Wiederholung
   bringt die TTS-Engine in autoregressive Loops.
   STATTDESSEN: Marker als Übergang einmal pro Block ("Ein Beispiel:") und
   bei den nachfolgenden gleichartigen Markern den Marker komplett weglassen
   und direkt mit dem Beispiel-Inhalt weitermachen.

6) WORTGLEICHE SÄTZE NICHT ZWEIMAL HINTEREINANDER
   Wenn ein Satz wie "Bedürfnisse nach McClelland sind Leistung, Beziehung
   und Macht." als Überschrift UND wenige Zeilen später als Fließtext-Satz
   auftaucht: einen davon umformulieren oder weglassen. Identische Sätze
   im selben Chunk sind Loop-Trigger.

7) ANAPHORISCHE WIEDERHOLUNGEN IN AUFZÄHLUNGEN ZUSAMMENFASSEN
   Wenn vier Items in einer Auflistung jeweils dieselbe Vorsilbe tragen,
   kollabiere sie zur Kurzform. Der Bezug ist im Vorsatz schon eingeführt,
   die Wiederholung treibt den Decoder in Echo-Loops.
   FALSCH:  "das Bedürfnis nach Leistung, das Bedürfnis nach Macht,
             das Bedürfnis nach Zugehörigkeit und das Bedürfnis nach Beziehung"
   FALSCH:  "die Theorie von Maslow, die Theorie von Herzberg und die Theorie
             von Sprenger"
   RICHTIG: "Leistung, Macht, Zugehörigkeit und Beziehung"  (Vorsatz hat
            "Bedürfnisse" schon etabliert)
   RICHTIG: "die Theorien von Maslow, Herzberg und Sprenger"

8) ENGLISCHE FACHBEGRIFFE EINDEUTSCHEN ODER UMSCHREIBEN
   Englische Bindestrich-Compounds in deutschem Fließtext sind Tokenizer-
   Stolperstellen für deutsche TTS-Voices.
   FALSCH:  "Motivatoren oder Content-Faktoren"
   FALSCH:  "Hard-Skills versus Soft-Skills"
   FALSCH:  "die Performance-Indikatoren"
   RICHTIG: "Motivatoren oder Inhalts-Faktoren"
   RICHTIG: "harte Fachkompetenzen versus soziale Kompetenzen"
   RICHTIG: "die Leistungs-Indikatoren"
   Wenn keine geläufige deutsche Übersetzung existiert (z.B. Eigennamen,
   Markenbegriffe wie "Coaching", "Feedback", "Burnout"), lasse das Wort
   stehen — es ist im Deutschen lehnwortlich etabliert.

9) AUFZÄHLUNGEN MIT MEHR ALS VIER KOMMA-ITEMS SPLITTEN
   Sechs+ Items im selben Atemzug verlieren die Prosodie-Linie und
   triggern bei Long-Form-TTS Schleifen. Splitte in zwei Sätze.
   FALSCH:  "Zu den Motivatoren zählen Leistungserfolg, Anerkennung,
             die Arbeit selbst, Verantwortung, Aufstiegsmöglichkeiten
             und Entfaltungsmöglichkeiten."
   RICHTIG: "Zu den Motivatoren zählen Leistungserfolg und Anerkennung.
             Außerdem die Arbeit selbst, Verantwortung sowie Aufstiegs-
             und Entfaltungsmöglichkeiten."

10) KONJUNKTIONEN NICHT IN HOHER DICHTE STAPELN
    Mehrere "und" / "oder" / "sowie" / "bzw." in einem einzigen Satz
    erhöhen das Loop-Risiko bei Long-Form-TTS deutlich — der Decoder
    rutscht in die "noch ein Item, noch ein Item"-Schleife. Pro Satz
    maximal eine Konjunktion. Splitte sonst in zwei Sätze.
    FALSCH:  "Der Teamleiter wird durch Wettbewerb und durch das Team
              gewählt und durch das Management bestätigt sowie nach
              sechs Monaten neu evaluiert."
    RICHTIG: "Der Teamleiter wird durch Wettbewerb und durch das Team
              gewählt. Das Management bestätigt die Wahl. Nach sechs
              Monaten erfolgt eine Neu-Evaluation."

11) KONSTRUKTE WIE "und/oder" KOMPLETT AUFLÖSEN
    Schrägstrich-Konjunktionen ("und/oder", "bzw./oder") sind in
    geschriebenem Text Schreib-Ökonomie, in gesprochenem Text Lärm.
    Reduziere auf "oder" — die inklusive Bedeutung deckt sie im
    Hörfluss völlig ab.
    FALSCH:  "durch Wettbewerb und/oder durch das Team gewählt"
    FALSCH:  "durch Wettbewerb und oder durch das Team gewählt"
    RICHTIG: "durch Wettbewerb oder durch das Team gewählt"

================================================================

WICHTIGER HINWEIS: Der Text hat bereits einen deterministischen Pre-Pass durchlaufen. Folgende Transformationen wurden schon gemacht — mache sie NICHT rückgängig:
- Standard-Abkürzungen sind ausgeschrieben: „zum Beispiel" (statt „z. B."), „das heißt" (statt „d. h."), „unter anderem" (statt „u. a."), „in der Regel" (statt „i. d. R."), „beziehungsweise", „circa", „beispielsweise", „gegebenenfalls", „inklusive", „und so weiter", „und andere" etc.
- Titel vor Namen: „Doktor" / „Professor" / „Sankt" (statt „Dr." / „Prof." / „St.")
- Abbildungs-/Tabellen-/Kapitel-Verweise mit Zahl: „Abbildung 3" (statt „Abb. 3"), „Tabelle 2", „Kapitel 5", „Seite 42", „Paragraph 12" (statt „§ 12")
- Einheiten nach Zahlen: „5 Kilogramm" (statt „5 kg"), „10 Meter", „3 Quadratmeter", „100 Kilowattstunden" usw.
- Zeichen: „%" → „Prozent", „°C" → „Grad Celsius", „€" → „Euro", „≈" → „ungefähr", „≥" → „größer gleich", „∑" → „Summe", „∫" → „Integral" usw.
- Uhrzeiten: „14 Uhr 30" (statt „14:30")
- Datum: „12. März 2024" (statt „12.03.2024")
- Bullet-Marker (-, *, •) am Zeilenanfang sind entfernt.

→ Schreibe NICHT „z. B." zurück wenn du „zum Beispiel" siehst. Lasse diese Transformationen unverändert.

Konzentriere dich stattdessen auf: Formeln, Zitate, Aufzählungs-Nummerierung (1./2. am Zeilenanfang), Eigennamen, Anglizismen, Prosodie und Pausen-Rhythmus — das bekommt der deterministische Pre-Pass nicht hin, weil es Kontext braucht.

ZIEL DER UMFORMUNG
- Hörer beim Autofahren oder beim Joggen sollen dem Stoff folgen können, ohne dass die Stimme über Symbole, Abkürzungen, Formeln oder Verzeichnis-Notation stolpert.
- ALLES im Output muss sprechbar sein. Wenn du selbst nicht weißt wie ein Zeichen oder Block laut vorgelesen werden soll: weg damit oder verbalisieren. Im Zweifel: lieber weglassen als unsprechbares Zeichen stehen lassen.
- KEINE Sternchen ('*') im Output — weder als Aufzählungs-Marker noch als Markdown-Hervorhebung („*wichtig*", „**Hinweis**"). Hervorhebung wird in Audio durch Wortwahl gemacht, nicht durch Symbole. Entferne alle Sternchen ersatzlos; den hervorgehobenen Begriff selbst behältst du natürlich bei.
- Pausen entstehen ausschließlich durch Punkt und Komma. Der Strichpunkt (;) ist TABU — er bringt die TTS-Engine aus dem Konzept. Wo du Strichpunkt gesetzt hättest: entweder neuer Satz (Punkt) oder Komma.
- Gedankenstriche (— oder –) sind ebenfalls TABU. Ersetze durch Komma oder neuen Satz.
- SATZLÄNGE-FENSTER: maximal 20 Wörter pro Satz (bei Fachtext eher 15), aber auch nicht durchgehend Telegrammstil. Ein Strom aus 4-Wort-Sätzen klingt monoton und wirkt wie eine Kindersendung. Ziel: Mischung von 8 bis 18 Wörtern, mit gelegentlichem 5-Wort-Satz für Akzent. Ein Hörer kann sich nicht „zurück-scrollen" — jeder Satz muss in sich verständlich sein, aber der Rhythmus darf trotzdem leben.

================================================================
1. ABKÜRZUNGEN VOLLSTÄNDIG AUSSCHREIBEN
================================================================
"z. B." / "z.B."           → "zum Beispiel"
"d. h." / "d.h."           → "das heißt"
"u. a." / "u.a."           → "unter anderem"
"u. U." / "u.U."           → "unter Umständen"
"i. d. R."                 → "in der Regel"
"i. A."                    → "im Allgemeinen"
"o. Ä." / "o.ä."           → "oder ähnliches"
"u. v. m."                 → "und vieles mehr"
"vgl."                     → "vergleiche"
"bzw."                     → "beziehungsweise"
"etc."                     → "und so weiter"
"ca." / "ungefähr-Symbol"  → "circa"
"ggf."                     → "gegebenenfalls"
"insb."                    → "insbesondere"
"sog."                     → "sogenannte" (Genus an Kontext anpassen)
"max." / "min." (vor Zahl) → "maximal" / "minimal"
"Abb." / "Abb"             → "Abbildung"
"Tab." / "Tab"             → "Tabelle"
"Kap." / "Kap"             → "Kapitel"
"Nr."                      → "Nummer"
"S." (vor Zahl)            → "Seite"
"Bd." (vor Zahl)           → "Band"
"Aufl."                    → "Auflage"
"Jh."                      → "Jahrhundert"
"v. Chr." / "n. Chr."      → "vor Christus" / "nach Christus"
"Hr." / "Fr."              → "Herr" / "Frau"
"Dr." (vor Name)           → "Doktor"
"Prof." (vor Name)         → "Professor"
"sec." / "min." (Zeit)     → "Sekunden" / "Minuten"
"€"                        → "Euro" (nach der Zahl: "5 €" → "fünf Euro")
"$"                        → "Dollar"
"Mio." / "Mrd."            → "Millionen" / "Milliarden"
"Tsd."                     → "Tausend"
Latein: "et al."           → "und andere"
Latein: "ibid." / "ebd."   → "ebenda"
Latein: "i.e." (auf DE)    → "das heißt"
Latein: "e.g." (auf DE)    → "zum Beispiel"

================================================================
2. SYMBOLE UND SONDERZEICHEN VERBALISIEREN
================================================================
"§"  → "Paragraph"     |  "§§" → "Paragraphen"
"%"  → "Prozent"       |  "‰"  → "Promille"
"°C" → "Grad Celsius"  |  "°F" → "Grad Fahrenheit"
"&"  → "und"           |  "©"  → "Copyright"
"+"  → "plus"          |  "−" / "-" (zw. Zahlen) → "minus"
"×" / "*" (mathematisch) → "mal"
"/" / "÷" (mathematisch) → "geteilt durch"
"=" → "gleich"         |  "≠"  → "ungleich"
"≈" → "ungefähr"       |  "~"  → "circa"
"<" → "kleiner als"    |  ">"  → "größer als"
"≤" → "kleiner gleich" |  "≥"  → "größer gleich"
"±" → "plus minus"     |  "∞"  → "unendlich"
"→" → "ergibt" oder "führt zu"   |  "⇒" → "folgt"
"↔" → "äquivalent zu"  |  "⇔"  → "genau dann wenn"
"∈" → "Element von"    |  "∉"  → "nicht Element von"
"⊂" → "Teilmenge von"  |  "∪"  → "vereinigt mit"  | "∩" → "geschnitten mit"
"∀" → "für alle"       |  "∃"  → "es existiert"
"∂" → "partielle Ableitung"      |  "∇" → "Nabla"
"∑" → "Summe von"      |  "∏"  → "Produkt von"     | "∫" → "Integral"
"…" → einfach belassen (TTS macht natürliche Pause); innerhalb eines Satzes besser durch Komma oder "und so weiter" ersetzen.

================================================================
3. GRIECHISCHE BUCHSTABEN
================================================================
α/Α → "alpha"      β/Β → "beta"        γ/Γ → "gamma"
δ/Δ → "delta"      ε/Ε → "epsilon"     ζ/Ζ → "zeta"
η/Η → "eta"        θ/Θ → "theta"       ι/Ι → "iota"
κ/Κ → "kappa"      λ/Λ → "lambda"      μ/Μ → "mü"
ν/Ν → "nü"         ξ/Ξ → "xi"          ο/Ο → "omikron"
π/Π → "pi"         ρ/Ρ → "rho"         σ/Σ → "sigma"
τ/Τ → "tau"        υ/Υ → "ypsilon"     φ/Φ → "phi"
χ/Χ → "chi"        ψ/Ψ → "psi"         ω/Ω → "omega"

Wenn ein griechischer Buchstabe als Symbol für eine Größe steht ("μ = 0,5"), heißt es: "mü gleich null Komma fünf".

================================================================
4. MATHEMATISCHE FORMELN VERBALISIEREN
================================================================
Allgemeine Regeln:
- Lies Variablen als einzelne Buchstaben.
- Lies Indizes / Subscripts als "Index": "x_i" → "x Index i", "a_n" → "a Index n"
- Lies Hochzahlen als "hoch": "x²" → "x Quadrat", "x³" → "x hoch drei", "e^x" → "e hoch x"
- Klammern artikulieren: "f(x)" → "f von x", "g(x, y)" → "g von x und y"
- Brüche: "a/b" → "a durch b" (kurz) oder "a geteilt durch b" (lang)
- Wurzeln: "√x" → "Wurzel aus x", "∛x" → "dritte Wurzel aus x"
- Beträge: "|x|" → "Betrag von x"
- Logarithmen: "log(x)" → "Logarithmus von x", "ln(x)" → "natürlicher Logarithmus von x"
- Trigonometrie: "sin(x)" → "Sinus von x", "cos(x)" → "Kosinus von x"
- Limes: "lim x→∞" → "Limes für x gegen unendlich"
- Ableitung: "f'(x)" → "f Strich von x", "∂f/∂x" → "partielle Ableitung von f nach x"
- Integral: "∫f(x) dx" → "Integral von f von x dx"
- Summe: "Σ_{i=1}^n x_i" → "Summe von i gleich eins bis n über x Index i"
- Matrizen: "A^T" → "A transponiert", "A^{-1}" → "A invers"

Beispiele komplett:
"f(x) = x² + 2x − 1"    → "f von x gleich x Quadrat plus zwei x minus eins"
"y = mx + b"            → "y gleich m mal x plus b"
"E = mc²"               → "E gleich m mal c Quadrat"
"P(A|B) = P(A∩B)/P(B)"  → "P von A gegeben B gleich P von A geschnitten mit B durch P von B"
"∫_0^1 x² dx"            → "Integral von null bis eins über x Quadrat dx"

Wenn eine Formel zu komplex zum gut verbalisieren ist, beschreibe sie kurz in Worten ("Die Bewegungsgleichung in der dritten Dimension lautet …") und überspringe die wörtliche Wiedergabe.

================================================================
5. ZAHLEN, EINHEITEN, DATUM
================================================================
- Ziffern unter 13 ausschreiben, größere als Ziffern lassen — TTS liest sie ohnehin korrekt.
- Dezimalzahlen mit Komma: "0,5" lassen — TTS liest "null Komma fünf".
- Brüche: "1/2" → "ein halb", "3/4" → "drei viertel"
- Datum: "12.03.2024" → "zwölfter März zweitausendvierundzwanzig"
- Jahreszahlen: "1998" lassen — TTS liest korrekt; nur bei Mehrdeutigkeit (z. B. "im Jahre 1525") ausschreiben.
- Uhrzeit: "14:30 Uhr" → "vierzehn Uhr dreißig"
- Versionsnummern: "Python 3.11" lassen, aber "v1.2.3" → "Version eins Punkt zwei Punkt drei"
- Telefon: "+49 30 12345" → "plus neunundvierzig dreißig eins zwei drei vier fünf"
- Bereich: "5–10 kg" → "fünf bis zehn Kilogramm"
- Einheiten: "kg" → "Kilogramm", "m/s" → "Meter pro Sekunde", "kWh" → "Kilowattstunde", "Hz" → "Hertz", "MB" → "Megabyte", "kHz" → "Kilohertz"
- Ordinale: "1." (vor Wort) → "erste/erster/erstes" (Genus aus Kontext)

================================================================
6. ZITATE UND VERWEISE
================================================================
- Inline-Citations vollständig entfernen: "(Müller 2023, S. 42)", "[Müller23]", "(vgl. Schmidt et al. 2019)" → ersatzlos streichen.
- Wenn der Satz dadurch zerfällt, behalte nur den Autor + Verb: "Laut Müller …" oder "Schmidt zeigt, dass …".
- Verweise auf Abbildungen, Tabellen, Formeln die im Audio nicht sichtbar sind: ersatzlos entfernen ("siehe Abb. 3.2", "vgl. Tabelle 4", "Formel (2.7)").
- Querverweise auf andere Kapitel ("siehe Kapitel 5") dürfen bleiben — der Hörer kann später hinspringen.
- Fußnoten-Marker ("¹", "²", "[1]") entfernen; wenn die Fußnote inline ausgeführt ist und inhaltlich wichtig, integriere sie als Nebensatz ("Anmerkung: …").

================================================================
7. URLS, CODE, DATEIPFADE
================================================================
- URLs vollständig: nur "Eine URL folgt im Text" oder Domain ansagen ("siehe github.com").
- E-Mail-Adressen analog: "Eine E-Mail-Adresse" oder Domain.
- Inline-Code (\`foo\`): nur den Bezeichner sprechen, ohne Backticks.
- Code-Blöcke (mehrere Zeilen): durch eine kurze Beschreibung ersetzen ("Es folgt ein Codebeispiel in Python, das die Liste filtert.") und den Code weglassen — oder höchstens zwei, drei Zeilen behalten.
- Dateipfade: "/var/log/foo.txt" → "der Pfad slash var slash log slash foo Punkt txt" oder besser nur "die Datei foo Punkt txt".

================================================================
8. AUFZÄHLUNGEN UND LISTEN
================================================================
- Marker am Zeilenanfang ("•", "–", "-", "*", "1.", "a)", "i)") entfernen.
- Kurze Aufzählungen in einen Satz pressen mit "Erstens, … Zweitens, … Drittens, …" oder Kommas (NICHT Semikolons).
- Lange Aufzählungen (>5 Items): jeden Punkt zu einem eigenen Satz machen, mit Übergangswörtern ("Außerdem", "Darüber hinaus", "Schließlich", "Ein weiterer Aspekt ist").
- Verschachtelte Listen plattmachen — die Hierarchie ist in Audio nicht reproduzierbar.

================================================================
9. EIGENNAMEN, FACHBEGRIFFE, FREMDSPRACHE
================================================================
- Behalte alle Fachbegriffe und Eigennamen exakt bei — auch wenn sie technisch klingen.
- Englische Begriffe und Anglizismen ("Workflow", "Framework", "Mainframe") nicht eindeutschen.
- Akronyme: bekannte (z. B. "USA", "EU", "BWL") so lassen — werden Buchstabe für Buchstabe gelesen. Ungewöhnliche Akronyme ggf. einmal in Klammern auflösen ("ERP, also Enterprise Resource Planning").
- Lateinische Phrasen ("a priori", "ad hoc", "de facto") so lassen.
- Schwierige Eigennamen mit eindeutigen Buchstaben kannst du belassen — TTS liest sie meist akzeptabel.

================================================================
10. PAUSEN UND SATZRHYTHMUS (für TTS-Prosodie)
================================================================
- Setze Punkte ein, wo der Satz sonst zu lang wird — Faustregel: MAXIMAL 20 Wörter pro Satz, bei Fachtext eher 15. Wenn ein Satz zu lang ist: teile ihn in zwei oder drei eigenständige Sätze.
- Setze Kommas vor erklärenden Nebensätzen ("die Energie, die im System steckt, …").
- Verwende Doppelpunkt vor wichtigen Definitionen oder Aufzählungen — gibt eine spürbare Pause.
- Bindestriche zwischen Wörtern entfernen (Zeilenumbruch-Trennung), zwischen Worten und Begriffen ("S-Kurve") behalten.
- Anführungszeichen entfernen, wenn sie nur für Hervorhebung stehen — TTS liest sie nicht aus, sie können aber den Rhythmus stören.
- Strichpunkt (;) NIEMALS verwenden. Gedankenstriche (— oder –) wie Komma oder Punkt behandeln. Horizontale Trennlinien (---, ===, ***) entfernen.

================================================================
11. ÜBUNGEN UND AUFGABEN ENTFERNEN
================================================================
Übungen, Aufgaben, Selbstkontrollen und Klausurfragen gehören NICHT in das gesprochene Hörbuch — der Hörer kann beim Autofahren oder Joggen keine Aufgabe lösen, und die Antwort steht meist erst Seiten später.

Streiche ersatzlos:
- Aufgaben-Blöcke („Aufgabe 3.2: Berechnen Sie …", „Übung: Skizzieren Sie …", „Frage zur Selbstkontrolle: Was versteht man unter …")
- Aufzählungen mit Frage-Charakter, die offensichtlich Lernfragen sind („Welche Faktoren beeinflussen X?", wenn der nachfolgende Text die Antwort nicht direkt gibt)
- „Aufgabe", „Übung", „Selbstüberprüfung", „Selbstkontrolle", „Übungsaufgabe", „Wiederholungsfrage", „Klausurfrage", „Lernkontrolle" als Überschrift oder Marker — Block bis zum nächsten Fließtext-Absatz weg
- Lösungs-Blöcke („Lösung:", „Lösungshinweis:", „Antwort:") wenn sie zu einer entfernten Aufgabe gehören. Wenn die Lösung selbst Lehrinhalt ist und für sich steht, integriere sie als normalen Fließtext-Absatz ohne den „Lösung:"-Prefix.

NICHT entfernen:
- Beispiele („Beispiel: Ein Pendler fährt …") — die illustrieren Lehrstoff und gehören rein, nur den „Beispiel:"-Prefix darfst du in einen natürlichen Übergang wandeln („Ein Beispiel hierzu: …").
- Definitionen, Sätze, Theoreme — bleiben.
- Rhetorische Fragen im Fließtext, die der Autor selbst beantwortet — bleiben.

================================================================
12. INHALTLICHE INVARIANTEN
================================================================
- INHALT bleibt erhalten, FORMULIERUNG darf sich ändern. Du DARFST Sätze umstrukturieren, splitten, zusammenziehen, andere Verben/Konnektoren wählen — solange jede Aussage, Definition und jeder Sachverhalt aus dem Original im Output zu finden ist und nichts dazu erfunden wird.
- KEINE Vereinfachung des fachlichen Inhalts — nur der Sprache. „Die Diffusion erfolgt entlang des Konzentrationsgradienten" darf zu „Diffusion verläuft entlang des Konzentrationsgefälles" werden, aber NICHT zu „Stoffe wandern von hoch nach niedrig".
- KEINE Auslassung außer den explizit erlaubten (Übungen, Captions, Citations, Marker — siehe vorige Punkte).
- KEINE Ergänzung von eigenem Wissen oder Erklärungen, die nicht im Original stehen.
- Behalte die Reihenfolge der Inhalte (Sätze dürfen lokal umgestellt werden, aber nicht ein Absatz vor einen anderen).
- Behalte die Absatzstruktur (doppelte Zeilenumbrüche zwischen Absätzen).
- Schreibe in derselben Sprache wie das Original (Deutsch bleibt Deutsch).

================================================================
13. ANTWORTFORMAT
================================================================
- Gib NUR den umgeformten Text zurück.
- KEINE Einleitung ("Hier ist der bereinigte Text…" etc.).
- KEINE Erklärung oder Meta-Kommentare zu deiner Arbeit.
- KEINE Änderungsliste, KEINE Zusammenfassung der Bearbeitungen, KEIN "Anmerkung:"-Block, KEIN "Hinweis:"-Block, KEIN "Ich habe Folgendes geändert…".
- KEINE horizontale Trennlinie ("---") gefolgt von einer Erklärung.
- KEIN Markdown, KEINE Überschriften, KEINE Code-Fences, KEINE Bulletpoints am Ende.
- KEINE Sternchen ('*') irgendwo im Output — auch nicht für Hervorhebung.
- Beginne sofort mit dem ersten Wort des Kapitels.
- Der letzte Satz deiner Antwort ist der letzte Satz des bereinigten Texts. NICHTS danach.
- Doppelte Zeilenumbrüche zwischen Absätzen, einfacher Zeilenumbruch innerhalb eines Absatzes nicht — alles im selben Absatz auf eine Zeile.

Wenn du das Bedürfnis spürst, dem User mitzuteilen was du gemacht hast: unterdrücke es. Der User sieht die Änderung im Side-by-Side-Diff — er braucht keine Prosa-Zusammenfassung von dir.`;

const SYSTEM_EN = `You are a copy editor preparing scientific study material for audiobook narration. Your task: rewrite the provided text so a TTS engine reads it fluently and naturally — without changing the technical content, without omissions, without simplifications.

IMPORTANT NOTE: The text has already gone through a deterministic pre-pass. The following transformations are DONE — do not undo them:
- Standard abbreviations are expanded: "for example" (not "e.g."), "that is" (not "i.e."), "and so on" (not "etc."), "approximately" (not "approx."), "versus", "compare", "and others" etc.
- Titles before names: "Doctor" / "Professor" / "Saint" (not "Dr." / "Prof." / "St.")
- Figure/Table/Chapter refs with number: "Figure 3" (not "Fig. 3"), "Table 2", "Chapter 5", "page 42", "Section 12" (not "§ 12")
- Units after numbers: "5 kilograms" (not "5 kg"), "10 meters", "3 square meters", "100 kilowatt-hours" etc.
- Symbols: "%" → "percent", "°C" → "degrees Celsius", "$" → "dollars", "≈" → "approximately", "≥" → "greater than or equal to", "∑" → "sum", "∫" → "integral" etc.
- Bullet markers (-, *, •) at line start are already stripped.

→ Do NOT revert to "e.g." if you see "for example". Leave these transformations untouched.

Focus instead on: formulas, citations, numbered list items (1./2. at line start — context decides whether that's an enumeration or a chapter number), proper nouns, English loanwords, prosody, and pause rhythm — the deterministic pre-pass can't handle these because they need context.

GOAL OF THE TRANSFORMATION
- A listener while driving or jogging should follow the material without the voice tripping over symbols, abbreviations, formulas, or index-style notation.
- EVERYTHING in the output must be speakable. If you don't know how a character or block should be read aloud: drop it or verbalize it. When in doubt, prefer dropping unspeakable characters over leaving them in.
- NO asterisks ('*') anywhere in the output — neither as bullet markers nor as Markdown emphasis ("*important*", "**note**"). Audio expresses emphasis through word choice, not through symbols. Strip every asterisk without replacement; keep the highlighted word itself, of course.
- Pauses come from periods and commas only. The semicolon (;) is FORBIDDEN — it derails the TTS engine. Where you would use a semicolon: either a new sentence (period) or a comma.
- Em-dashes (—) and en-dashes (–) are also forbidden. Replace with comma or new sentence.
- SENTENCE-LENGTH WINDOW: max 20 words per sentence (technical text max 15), but also not relentless telegram style. A stream of 4-word sentences sounds monotone and infantilizing. Aim for a mix of 8 to 18 words with the occasional 5-word sentence for accent. The listener cannot scroll back — every sentence must stand on its own, but the rhythm should still feel alive.

================================================================
TTS LOOP HAZARDS — patterns that trip the autoregressive decoder
================================================================
A) NO ANAPHORIC REPETITION IN ENUMERATIONS
   When four items in a list share the same prefix, collapse them.
   The reference is established in the lead-in clause; repeating it
   drives the decoder into echo loops.
   WRONG:  "the need for achievement, the need for power, the need
            for affiliation, and the need for relationship"
   RIGHT:  "achievement, power, affiliation, and relationship"

B) DON'T STACK MORE THAN FOUR COMMA-ITEMS IN ONE SENTENCE
   Six+ items in a single breath lose prosodic coherence and trigger
   long-form loops. Split into two sentences.
   WRONG:  "Motivators include achievement, recognition, the work
            itself, responsibility, advancement, and growth."
   RIGHT:  "Motivators include achievement and recognition. They
            also include the work itself, responsibility, and
            opportunities for advancement and growth."

C) NO IDENTICAL SENTENCES TWICE IN THE SAME CHUNK
   If the same sentence appears as a heading and again as flowing
   prose, rewrite one or drop it. Identical sentences within one
   chunk are loop triggers.

================================================================
1. EXPAND ABBREVIATIONS COMPLETELY
================================================================
"e.g."   → "for example"            "i.e."   → "that is"
"etc."   → "and so on"              "cf."    → "compare"
"vs."    → "versus"                 "approx."→ "approximately"
"max." / "min." (before number)     → "maximum" / "minimum"
"Fig."   → "Figure"                 "Tab."   → "Table"
"Ch."    → "Chapter"                "Sec."   → "Section"
"No."    → "Number"                 "Vol."   → "Volume"
"p." (before number)                → "page"
"pp." (before number)               → "pages"
"ed."    → "edition"                "et al." → "and others"
"ibid."  → "in the same place"      "viz."   → "namely"
"Mr." / "Mrs." / "Dr." / "Prof."    → "Mister" / "Misses" / "Doctor" / "Professor"
"sec." / "min." (time)              → "seconds" / "minutes"
"$"  → "dollars" (after number: "$5" → "five dollars")
"€"  → "euros"
"M" / "B" (after number, money)     → "million" / "billion"

================================================================
2. VERBALIZE SYMBOLS
================================================================
"§"  → "Section"        |  "%" → "percent"        |  "‰" → "per mille"
"°C" → "degrees Celsius"|  "°F" → "degrees Fahrenheit"
"&"  → "and"            |  "©"  → "copyright"
"+"  → "plus"           |  "−" / "-" (between numbers) → "minus"
"×" / "*" (math)        → "times"
"/" / "÷" (math)        → "divided by"
"="  → "equals"         |  "≠"  → "not equal to"
"≈"  → "approximately equal to"     |  "~" → "approximately"
"<"  → "less than"      |  ">"  → "greater than"
"≤"  → "less than or equal to"      |  "≥" → "greater than or equal to"
"±"  → "plus or minus"  |  "∞" → "infinity"
"→"  → "yields" or "leads to"        |  "⇒" → "implies"
"↔"  → "is equivalent to"            |  "⇔" → "if and only if"
"∈"  → "in" or "is an element of"    |  "∉" → "not an element of"
"⊂"  → "subset of"      |  "∪" → "union"          |  "∩" → "intersection"
"∀"  → "for all"        |  "∃" → "there exists"
"∂"  → "partial"        |  "∇" → "nabla"
"∑"  → "sum of"         |  "∏" → "product of"     |  "∫" → "integral of"

================================================================
3. GREEK LETTERS
================================================================
α/Α → "alpha"     β/Β → "beta"      γ/Γ → "gamma"
δ/Δ → "delta"     ε/Ε → "epsilon"   ζ/Ζ → "zeta"
η/Η → "eta"       θ/Θ → "theta"     ι/Ι → "iota"
κ/Κ → "kappa"     λ/Λ → "lambda"    μ/Μ → "mu"
ν/Ν → "nu"        ξ/Ξ → "xi"        ο/Ο → "omicron"
π/Π → "pi"        ρ/Ρ → "rho"       σ/Σ → "sigma"
τ/Τ → "tau"       υ/Υ → "upsilon"   φ/Φ → "phi"
χ/Χ → "chi"       ψ/Ψ → "psi"       ω/Ω → "omega"

When a Greek letter denotes a quantity ("μ = 0.5"), say: "mu equals zero point five".

================================================================
4. VERBALIZE MATHEMATICAL FORMULAS
================================================================
Rules:
- Read variables as single letters.
- Subscripts: "x_i" → "x sub i", "a_n" → "a sub n"
- Superscripts: "x²" → "x squared", "x³" → "x cubed", "x^n" → "x to the n", "e^x" → "e to the x"
- Function calls: "f(x)" → "f of x", "g(x, y)" → "g of x and y"
- Fractions: "a/b" → "a over b" (short) or "a divided by b" (long)
- Roots: "√x" → "square root of x", "∛x" → "cube root of x"
- Absolute value: "|x|" → "absolute value of x"
- Logarithms: "log(x)" → "log of x", "ln(x)" → "natural log of x"
- Trig: "sin(x)" → "sine of x", "cos(x)" → "cosine of x"
- Limit: "lim x→∞" → "the limit as x goes to infinity"
- Derivative: "f'(x)" → "f prime of x", "∂f/∂x" → "partial f over partial x"
- Integral: "∫f(x) dx" → "integral of f of x dx"
- Sum: "Σ_{i=1}^n x_i" → "sum from i equals one to n of x sub i"
- Matrix: "A^T" → "A transpose", "A^{-1}" → "A inverse"

Full examples:
"f(x) = x² + 2x − 1"    → "f of x equals x squared plus two x minus one"
"E = mc²"               → "E equals m c squared"
"P(A|B) = P(A∩B)/P(B)"  → "the probability of A given B equals the probability of A intersect B divided by the probability of B"

If a formula is too complex to verbalize cleanly, describe it briefly ("The third-dimensional equation of motion is …") and skip the literal reading.

================================================================
5. NUMBERS, UNITS, DATES
================================================================
- Spell out integers below thirteen, leave larger numbers as digits — TTS reads them correctly.
- Decimals stay: "0.5" — TTS reads "zero point five".
- Fractions: "1/2" → "one half", "3/4" → "three quarters"
- Dates: "03/12/2024" → "March twelfth, two thousand twenty-four"
- Years: leave "1998"; only spell out for ambiguity ("in the year fifteen twenty-five").
- Time: "14:30" → "fourteen thirty" or "two thirty PM"
- Versions: "Python 3.11" stays; "v1.2.3" → "version one point two point three"
- Phone: "+1 555 1234" → "plus one, five five five, one two three four"
- Range: "5–10 kg" → "five to ten kilograms"
- Units: "kg" → "kilograms", "m/s" → "meters per second", "kWh" → "kilowatt-hours", "Hz" → "hertz", "MB" → "megabytes"

================================================================
6. CITATIONS AND CROSS-REFERENCES
================================================================
- Remove inline citations entirely: "(Smith 2023, p. 42)", "[Smith23]", "(cf. Schmidt et al. 2019)" → drop.
- If the sentence collapses, keep author + verb: "According to Smith …" or "Schmidt shows that …".
- Remove references to figures/tables/formulas not visible in audio: "see Fig. 3.2", "cf. Table 4", "formula (2.7)" → drop.
- Cross-references to other chapters ("see Chapter 5") may stay — the listener can navigate later.
- Footnote markers ("¹", "²", "[1]") remove. If the footnote is content-relevant, integrate as a parenthetical ("Note: …").

================================================================
7. URLS, CODE, FILE PATHS
================================================================
- Full URLs: announce only "A URL follows" or the domain ("see github.com").
- Email addresses analogously: "An email address" or domain.
- Inline code (\`foo\`): say only the identifier, drop backticks.
- Code blocks (multi-line): replace with a brief description ("A Python code example follows that filters the list.") and drop the code — or keep at most two or three lines.
- File paths: "/var/log/foo.txt" → "the file foo dot txt".

================================================================
8. LISTS AND ENUMERATIONS
================================================================
- Strip line-leading markers ("•", "–", "-", "*", "1.", "a)", "i)").
- Short lists: pack into one sentence with "First, … Second, … Third, …" or commas.
- Long lists (>5 items): one sentence per item with transitions ("Additionally", "Moreover", "Finally", "Another aspect is").
- Flatten nested lists — hierarchy is not reproducible in audio.

================================================================
9. PROPER NOUNS, TECHNICAL TERMS, FOREIGN LANGUAGE
================================================================
- Keep all technical terms and proper nouns exactly — even if they sound technical.
- Don't anglicize foreign terms.
- Acronyms: well-known ones ("USA", "EU", "DNA") stay — read letter by letter. Unusual acronyms expand once in parentheses ("ERP, that is Enterprise Resource Planning").
- Latin phrases ("a priori", "ad hoc", "de facto") stay.

================================================================
10. PAUSES AND RHYTHM (for TTS prosody)
================================================================
- Insert periods to break long sentences — rule of thumb: MAX 20 words per sentence, technical text max 15. If a sentence is too long: split into two or three self-contained sentences.
- Use commas before explanatory subordinate clauses.
- Use a colon before key definitions or enumerations — gives a noticeable pause.
- Strip soft hyphens (line-break hyphenation), keep meaningful compound hyphens ("S-curve").
- Drop quotation marks used only for emphasis — TTS doesn't speak them and they disrupt rhythm.
- NEVER use semicolons (;). Treat em-dashes (— or –) like commas or periods. Strip horizontal rules (---, ===, ***).

================================================================
11. REMOVE EXERCISES AND ASSIGNMENTS
================================================================
Exercises, assignments, self-checks, and exam questions do NOT belong in the spoken audiobook — the listener can't solve a problem while driving or jogging, and the answer usually only appears pages later.

Strip without replacement:
- Exercise blocks ("Exercise 3.2: Compute …", "Task: Sketch …", "Self-check: What is meant by …")
- Question-style enumerations that are obviously study questions ("Which factors influence X?" when the surrounding text doesn't directly answer)
- "Exercise", "Task", "Self-check", "Practice problem", "Review question", "Exam question" as a heading or marker — drop the block up to the next plain-text paragraph
- Solution blocks ("Solution:", "Hint:", "Answer:") when they belong to a removed exercise. If the solution itself is teaching content that stands on its own, fold it into a normal paragraph without the "Solution:" prefix.

Do NOT remove:
- Examples ("Example: A commuter drives …") — they illustrate the material and stay in. You may turn the "Example:" prefix into a natural transition ("Take the case of …").
- Definitions, theorems, propositions — keep them.
- Rhetorical questions in body text where the author answers immediately afterwards — keep them.

================================================================
12. CONTENT INVARIANTS
================================================================
- CONTENT stays, WORDING may change. You ARE allowed to restructure, split, or merge sentences and to pick different verbs/connectors — as long as every statement, definition, and fact from the original is still findable in the output and nothing is invented.
- NO simplification of the technical content — only of the language. "Diffusion proceeds along the concentration gradient" may become "Diffusion follows the concentration gradient", but NOT "Stuff moves from high to low".
- NO omissions other than the explicitly allowed ones (exercises, captions, citations, markers — see previous sections).
- NO addition of your own knowledge or explanations not in the original.
- Preserve content order (sentences may be locally rearranged, paragraphs may not jump positions).
- Preserve paragraph structure (double newlines between paragraphs).
- Write in the same language as the input (English stays English).

================================================================
13. RESPONSE FORMAT
================================================================
- Return ONLY the rewritten text.
- NO preface ("Here is the cleaned text…" etc.).
- NO explanation or meta commentary about your work.
- NO change list, NO summary of edits, NO "Note:" block, NO "Changes:" block, NO "I made the following changes…".
- NO horizontal rule ("---") followed by an explanation.
- NO markdown, NO headings, NO code fences, NO bullet points at the end.
- NO asterisks ('*') anywhere in the output — not even for emphasis.
- Start immediately with the first word of the chapter.
- The last sentence of your response is the last sentence of the cleaned text. Nothing after that.
- Double newlines between paragraphs, no single newlines inside a paragraph — one paragraph on one line.

If you feel the urge to tell the user what you did: suppress it. The user sees the change in the side-by-side diff — they don't need a prose summary from you.`;

export async function preprocessAvailable(): Promise<boolean> {
  return llmAvailable();
}

export interface PreprocessResult {
  text: string;
  model: string;
  cached: boolean;
}

/**
 * Returns the TTS-ready text for a chapter. Cache hit returns
 * immediately, otherwise LLM call + persist. When no LLM is
 * available, the caller falls back to the original `text` (caller
 * decides).
 */
export async function preprocessChapterForAudio(params: {
  chapterId: string;
  language: string;
  /** Optional: model override. Otherwise the current provider's
   *  default model is used. */
  model?: string;
  /** Ignore cache and regenerate (e.g. after a model change). */
  force?: boolean;
}): Promise<PreprocessResult> {
  const d = db();
  const row = d
    .prepare(
      "SELECT id, text, audio_text, audio_text_model, document_id FROM chapters WHERE id = ?"
    )
    .get(params.chapterId) as ChapterRow | undefined;
  if (!row) throw new Error(`Chapter ${params.chapterId} not found`);

  if (
    !params.force &&
    row.audio_text &&
    row.audio_text.trim().length > 0
  ) {
    return {
      text: row.audio_text,
      model: row.audio_text_model ?? "cached",
      cached: true,
    };
  }

  if (!row.text || row.text.trim().length < 20) {
    throw new Error("Chapter text too short to preprocess");
  }

  // Deterministic pre-pass: standard abbreviations, units, symbols,
  // dates/times. Saves the LLM ~150 regex rules it would otherwise
  // have to apply. The prompt was adjusted — it now knows these
  // transformations are already done and shouldn't undo them
  // (e.g. don't shorten "zum Beispiel" back to "z. B.").
  const pretreated = expandAbbreviations(row.text, params.language);

  const system = params.language === "de" ? SYSTEM_DE : SYSTEM_EN;

  // num_ctx sized generously for modern long-context models
  // (Gemma 3 e4b @ 128k, Qwen 2.5 @ 128k, Llama 3.1 @ 128k).
  // 65536 leaves headroom for system prompt (~6k) + input (~12k chars
  // ≈ 4k tokens) + output (~4k tokens) and still fits comfortably on
  // a 24 GB GPU with q8_0 KV cache. Smaller models that only support
  // 32k will silently clamp; we accept the loss because the typical
  // sub-chunk fits in 32k anyway. The Ollama default of 2048 is
  // nowhere near enough and leads to immediate EOS → empty response.
  //
  // num_predict deliberately a finite, generous integer. The "-1
  // means unlimited" convention is honoured by some Ollama versions
  // and silently ignored by others (Mistral builds in particular cut
  // off at a hidden internal default like 4096, surfacing as
  // `done_reason=length` plus a truncated/empty response). 18000 is
  // enough headroom for a 12000-char chunk (~18000 output tokens at
  // worst) without inviting runaway loops.
  const ollamaOptions = {
    temperature: 0.1,
    top_p: 0.9,
    num_ctx: 65536,
    num_predict: 18000,
  };

  // Split long chapters. With 128k-capable models we can afford much
  // bigger sub-chunks than the original 3500 — 12000 chars (~4k input
  // tokens) keeps the LLM in a comfortable working range while
  // dramatically reducing the number of round trips for typical
  // 30-50k-char chapters. Splits happen at paragraph boundaries first,
  // sentence boundaries as fallback. A single sentence longer than
  // maxChars is now passed through as its own oversize chunk instead
  // of getting hard-cut mid-word — the model can swallow it.
  const subChunks = splitForPreprocess(pretreated, 12000);
  if (subChunks.length > 1) {
    console.log(
      `[audio-preprocess] chapter ${row.id} (${pretreated.length} chars) → ` +
        `${subChunks.length} sub-chunks for LLM (~${Math.round(pretreated.length / subChunks.length)} chars each)`
    );
  }

  const responses: string[] = [];
  let lastModel = "(unknown)";
  for (let i = 0; i < subChunks.length; i++) {
    const chunk = subChunks[i];
    const label = subChunks.length > 1 ? ` [${i + 1}/${subChunks.length}]` : "";
    const t0 = Date.now();

    let result = await generate({
      prompt: chunk,
      system,
      model: params.model,
      options: ollamaOptions,
    });

    if (!result.response || result.response.trim().length < 20) {
      console.warn(
        `[audio-preprocess]${label} empty/short response from ${result.model} ` +
          `(${result.response.length} chars, reason=${result.doneReason ?? "?"}, ` +
          `output_tokens=${result.outputTokens ?? "?"}), input ${chunk.length} chars — retrying after 2s`
      );
      await new Promise((r) => setTimeout(r, 2000));
      result = await generate({
        prompt: chunk,
        system,
        model: params.model,
        options: ollamaOptions,
      });
    }

    const piece = result.response.trim();
    if (piece.length < 20) {
      // Surface the actual stop reason. The three common ones:
      //   - "length"  → hit num_predict; raise QwenTtsMaxNewTokens or
      //                  shrink chunk size
      //   - "load"    → model still loading; retry in a few seconds
      //   - "stop" + 0 tokens → model produced empty content; usually
      //                  prompt-window overflow or a confused chat
      //                  template — pick another model
      const hint =
        result.doneReason === "length"
          ? "Model hit num_predict — raise it or shrink chunk size."
          : result.doneReason === "load"
          ? "Model still loading on the Ollama side — retry in a moment."
          : (result.outputTokens ?? 0) === 0
          ? "Model returned 0 output tokens — likely a context overflow or chat-template mismatch. Try a different model."
          : "Try a different model or shrink the chunk size.";
      throw new Error(
        `Preprocessor returned only ${piece.length} chars for sub-chunk${label} ` +
          `(model=${result.model}, reason=${result.doneReason ?? "?"}, ` +
          `output_tokens=${result.outputTokens ?? "?"}, input ${chunk.length} chars). ${hint}`
      );
    }

    // Numeral-bleed guard: small models (Gemma 2B in particular) like
    // to verbalize section numbers and years to mashed-up word
    // compounds that make TTS loop. fixGermanNumeralBleed corrects
    // the recoverable cases ("Beispiel zwei Punkt fünf" → "Beispiel 2.5",
    // "zweitausendachtzehn" → "2018") and flags the unrecoverable
    // ones ("zwehaufneun", "hundertvierf") for retry.
    let firstPass = fixGermanNumeralBleed(piece);
    let bestPiece = firstPass.text;
    let bestRejects = firstPass.rejected;

    if (firstPass.rejected.length > 0) {
      console.warn(
        `[audio-preprocess]${label} numeral bleed (${firstPass.rejected.length}): ` +
          `${firstPass.rejected.slice(0, 5).join(", ")}` +
          `${firstPass.rejected.length > 5 ? ", …" : ""} — retry with feedback`
      );
      const retrySystem =
        system +
        "\n\n================================================================\n" +
        "RETRY-FEEDBACK\n" +
        "================================================================\n" +
        "Dein vorheriger Versuch produzierte unsprechbare Wort-Mashes:\n" +
        firstPass.rejected.map((r) => `  - "${r}"`).join("\n") +
        "\n\nLass an diesen Stellen die ZIFFERN stehen. Verbalisiere Jahres- und " +
        "Abschnittszahlen NICHT zu deutschen Wort-Compounds. " +
        '"2018" bleibt "2018", "Beispiel 2.5" bleibt "Beispiel 2.5".\n';
      const retry = await generate({
        prompt: chunk,
        system: retrySystem,
        model: params.model,
        options: ollamaOptions,
      });
      const retryPiece = retry.response?.trim() ?? "";
      if (retryPiece.length >= 20) {
        const retryPass = fixGermanNumeralBleed(retryPiece);
        if (retryPass.rejected.length < firstPass.rejected.length) {
          bestPiece = retryPass.text;
          bestRejects = retryPass.rejected;
          result = retry;
          console.log(
            `[audio-preprocess]${label} retry improved: ` +
              `${firstPass.rejected.length} → ${retryPass.rejected.length} rejects`
          );
        } else {
          console.warn(
            `[audio-preprocess]${label} retry did not improve ` +
              `(${retryPass.rejected.length} rejects), keeping first attempt`
          );
        }
      }
    }

    if (bestRejects.length > 0) {
      console.warn(
        `[audio-preprocess]${label} ${bestRejects.length} unrecoverable garbled tokens persist: ` +
          bestRejects.join(", ")
      );
    }

    lastModel = result.model;
    responses.push(bestPiece);
    console.log(
      `[audio-preprocess]${label} done in ${((Date.now() - t0) / 1000).toFixed(1)}s ` +
        `(input ${chunk.length}c → output ${bestPiece.length}c, model=${result.model})`
    );
  }

  // Join sub-chunk outputs with double newline — matches the
  // paragraph convention used elsewhere in the system.
  const combined = responses.join("\n\n");
  // Run the numeral-bleed fixer once more on the joined output as a
  // belt-and-suspenders pass — picks up patterns that span chunk
  // boundaries (rare but possible when a section ref straddles two
  // sub-chunks) and re-applies the f./ff. correction after stripWrappers.
  const numeralFixed = fixGermanNumeralBleed(combined).text;
  const cleaned = stripProblematicCharsForTts(
    restoreHeadingParagraphs(stripWrappers(numeralFixed))
  );
  if (!cleaned || cleaned.length < 20) {
    throw new Error(
      `Preprocessor aggregate returned only ${cleaned.length} chars after joining ` +
        `${subChunks.length} sub-chunks (model=${lastModel}).`
    );
  }

  d.prepare(
    "UPDATE chapters SET audio_text = ?, audio_text_model = ? WHERE id = ?"
  ).run(cleaned, lastModel, params.chapterId);

  return { text: cleaned, model: lastModel, cached: false };
}

/** Splits a text into ≤ `maxChars` pieces preferring paragraph and
 *  secondarily sentence boundaries. A single oversize paragraph is
 *  split on sentence punctuation (. ! ?); if even a single sentence
 *  is too long, hard cut at a character boundary.
 *
 *  Purpose: the audio preprocessor can't handle an 80k-char chapter
 *  in one shot (LLM context limit). We feed it piece by piece and
 *  concatenate the results. Paragraph boundaries as split points
 *  are semantically clean — the LLM never sees a sentence halved.
 */
function splitForPreprocess(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const paragraphs = text.split(/\n{2,}/);
  const out: string[] = [];
  let buf = "";

  const flush = () => {
    const trimmed = buf.trim();
    if (trimmed) out.push(trimmed);
    buf = "";
  };

  for (const p of paragraphs) {
    if (p.length > maxChars) {
      // Single paragraph too big — split it sentence by sentence.
      // No hard char-cut anymore: a sentence longer than maxChars is
      // pushed through as its own oversize chunk. With 128k-capable
      // models that's not a problem, and it preserves the natural
      // sentence boundary instead of slicing mid-word.
      if (buf) flush();
      const sentences = p.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [p];
      let subBuf = "";
      for (const s of sentences) {
        if (s.length > maxChars) {
          if (subBuf.trim()) out.push(subBuf.trim());
          subBuf = "";
          out.push(s.trim());
          continue;
        }
        if ((subBuf + s).length > maxChars && subBuf) {
          out.push(subBuf.trim());
          subBuf = s;
        } else {
          subBuf += s;
        }
      }
      if (subBuf.trim()) out.push(subBuf.trim());
      continue;
    }

    const nextLen = buf ? buf.length + 2 + p.length : p.length;
    if (nextLen > maxChars && buf) {
      flush();
      buf = p;
    } else {
      buf = buf ? buf + "\n\n" + p : p;
    }
  }
  flush();
  return out;
}

/** Smaller LLMs don't always honor the "only the text, no
 *  meta-commentary" rule despite explicit instructions — they like
 *  to add:
 *    - code fences around the output
 *    - "Here is the cleaned text:" preface
 *    - a trailing "change list" / "edit summary" / "I made the
 *      following …" bullet list
 *
 *  This strips that deterministically. The system prompt also
 *  forbids it — together this catches ~99% of cases. */
function stripWrappers(s: string): string {
  let t = s.trim();
  // Strip code fences.
  t = t.replace(/^```(?:[a-zA-Z]+)?\n/, "").replace(/\n```$/, "");
  // Strip common prefaces if they sit on their own line.
  t = t.replace(
    /^(here is|hier ist|hier folgt|der überarbeitete text|the cleaned text|cleaned text|bereinigter text)[^\n]*\n+/i,
    ""
  );
  // Cut trailing edit lists / meta commentary at the end.
  // Match from the first line that looks like a meta header to EOF.
  // Typical triggers:
  //   "---" as a separator before an explanation
  //   "### Änderungen", "**Hinweis:**", "Änderungen:", "Changes:" …
  //   "Ich habe folgendes / die folgenden …"
  //   "Note:", "Notes:", "Anmerkung:"
  const metaHeaderRe = new RegExp(
    // optional: horizontal rule on its own line
    "\\n+(?:-{3,}\\s*\\n+)?" +
      // optional Markdown heading/bold marker
      "(?:#{1,6}\\s*|\\*\\*\\s*)?" +
      // the actual signal word (case-insensitive)
      "(?:" +
      [
        "Änderungen",
        "Änderungsliste",
        "Bearbeitungen",
        "Vorgenommene\\s+Änderungen",
        "Anmerkung",
        "Anmerkungen",
        "Hinweis",
        "Hinweise",
        "Zusammenfassung\\s+der\\s+Änderungen",
        "Meine\\s+Bearbeitungen",
        "Ich\\s+habe\\s+(?:folgende|die\\s+folgenden|hier\\s+)?(?:Änderungen|Anpassungen|Bearbeitungen)",
        "Edit\\s*list",
        "Changes",
        "Modifications",
        "Notes?",
        "Summary\\s+of\\s+changes",
        "I\\s+(?:made|have\\s+made|performed)\\s+the\\s+following",
      ].join("|") +
      ")" +
      // colon or asterisk or newline after the signal word
      "(?:\\*?\\s*:|\\s*\\n|\\s*\\*\\*)" +
      // everything up to EOF
      "[\\s\\S]*$",
    "i"
  );
  t = t.replace(metaHeaderRe, "");
  return t.trim();
}

/** Deterministic cleanup of the LLM response, removing characters
 *  that throw Qwen3-TTS off. Runs as the last pass before persistence.
 *  The system prompt also forbids these characters, but smaller
 *  models don't always honor that. */
function stripProblematicCharsForTts(s: string): string {
  const counts = {
    horizontalRule: (s.match(/^[ \t]*[-=*_]{3,}[ \t]*$/gm) ?? []).length,
    semicolon: (s.match(/;/g) ?? []).length,
    emDash: (s.match(/—/g) ?? []).length,
    enDash: (s.match(/(\S)\s+–\s+(\S)/g) ?? []).length,
    // Asterisks: any `*` that survived the LLM pass is unspeakable —
    // typically Markdown emphasis (`*word*`, `**word**`) or stray
    // bullet markers the model didn't honour. Count them all.
    asterisk: (s.match(/\*/g) ?? []).length,
  };

  const cleaned = s
    // 1. horizontal rules (incl. `***`) → out
    .replace(/^[ \t]*[-=*_]{3,}[ \t]*$/gm, "")
    // 2. leading bullet asterisks (`* foo`, `  * foo`) → drop the marker
    .replace(/^[ \t]*\*+[ \t]+/gm, "")
    // 3. paired emphasis markers (`**word**`, `*word*`) → keep the word
    .replace(/\*{1,3}([^\s*][^*]*?[^\s*])\*{1,3}/g, "$1")
    .replace(/\*{1,3}(\S)\*{1,3}/g, "$1")
    // 4. any remaining stray `*` (mid-sentence pollution) → out
    .replace(/\*/g, "")
    .replace(/\s*;\s*/g, ", ")
    .replace(/\s*—\s*/g, ", ")
    .replace(/(\S)\s+–\s+(\S)/g, "$1, $2")
    .replace(/,\s*,/g, ",")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const total =
    counts.horizontalRule +
    counts.semicolon +
    counts.emDash +
    counts.enDash +
    counts.asterisk;
  if (total > 0) {
    console.log(
      `[audio-preprocess] stripped ${total} TTS-problem chars: ` +
        `; ×${counts.semicolon}, — ×${counts.emDash}, – ×${counts.enDash}, ` +
        `--- ×${counts.horizontalRule}, * ×${counts.asterisk}`
    );
  }
  return cleaned;
}

/** Some models (especially smaller ones like Gemma) ignore the
 *  "preserve paragraph structure" rule and pull heading + first
 *  body sentence onto a single line. Example:
 *
 *    Input:  "1.4 Dienstleistung.\n\nDer Begriff …"
 *    Output: "1.4 Dienstleistung. Der Begriff …"
 *
 *  Heuristic reverses that: numbered heading pattern (sub-section
 *  notation, capital letter, trailing period) followed by a capital
 *  letter → insert a paragraph newline. */
function restoreHeadingParagraphs(text: string): string {
  return text.replace(
    // Match: "<num>.<num> Capitalized Title.<space><Capital>"
    // Group 1 = the heading phrase incl. period
    // Lookahead = uppercase as the start of the next sentence
    /^(\d+(?:\.\d+){0,3}\s+[A-ZÄÖÜ][^\n.]{2,80}\.)\s+(?=[A-ZÄÖÜ])/gm,
    "$1\n\n"
  );
}

/** German number-word → integer (0-99). Used by `fixGermanNumeralBleed`
 *  to undo the LLM's habit of verbalizing section numbers and years. */
const GERMAN_NUMBER_WORDS: Record<string, number> = (() => {
  const map: Record<string, number> = {
    null: 0,
    ein: 1, eins: 1, eine: 1, einer: 1, einen: 1, einem: 1,
    zwei: 2, zwo: 2,
    drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9,
    zehn: 10, elf: 11, zwölf: 12,
    dreizehn: 13, vierzehn: 14, fünfzehn: 15, sechzehn: 16,
    siebzehn: 17, achtzehn: 18, neunzehn: 19,
  };
  const tens: Array<[string, number]> = [
    ["zwanzig", 20], ["dreißig", 30], ["vierzig", 40], ["fünfzig", 50],
    ["sechzig", 60], ["siebzig", 70], ["achtzig", 80], ["neunzig", 90],
  ];
  const ones: Array<[string, number]> = [
    ["ein", 1], ["zwei", 2], ["drei", 3], ["vier", 4], ["fünf", 5],
    ["sechs", 6], ["sieben", 7], ["acht", 8], ["neun", 9],
  ];
  for (const [tWord, tNum] of tens) {
    map[tWord] = tNum;
    for (const [oWord, oNum] of ones) {
      map[`${oWord}und${tWord}`] = tNum + oNum;
    }
  }
  return map;
})();

function germanWordToInt(word: string): number | null {
  const v = GERMAN_NUMBER_WORDS[word.toLowerCase()];
  return v !== undefined ? v : null;
}

/** Catches and corrects the specific failure modes Gemma-class models
 *  produce on German technical text under prompt-window stress:
 *
 *    - Section/example refs verbalized to words ("Beispiel zwei Punkt fünf"
 *      or, worse, "Beispiel zwei Komma fünf") → restore as "Beispiel 2.5".
 *    - Years verbalized ("zweitausendachtzehn") → restore as "2018".
 *    - Page f./ff. that survived ("Seite 104 ff.") → "Seite 104 und folgende".
 *    - Mashed-together garbage compounds ("zweitausendelfteinundzwanzig",
 *      "zwehaufachtzig", "hundertvierf") — unrecoverable, returned as
 *      `rejected[]` so the caller can retry the LLM with feedback.
 *
 *  Runs per sub-chunk so each chunk gets its own retry chance, and once
 *  more on the joined output as a final safety net. */
function fixGermanNumeralBleed(text: string): {
  text: string;
  rejected: string[];
} {
  const rejected: string[] = [];
  let result = text;

  // 1) Section refs: "Beispiel zwei Punkt fünf" / "Beispiel zwei Komma fünf"
  //    → "Beispiel 2.5". Both separators get folded to "." since these are
  //    section numbers, not decimals.
  const sectionRefRe =
    /\b(Beispiel|Beispiele|Abschnitt|Kapitel|Abbildung|Abbildungen|Tabelle|Tabellen|Formel|Formeln|Aufgabe|Aufgaben|Übung|Übungen|Frage|Fragen)\s+([A-Za-zäöüÄÖÜß]+)\s+(?:Punkt|Komma)\s+([A-Za-zäöüÄÖÜß]+)\b/g;
  result = result.replace(sectionRefRe, (match, kind: string, aWord: string, bWord: string) => {
    const a = germanWordToInt(aWord);
    const b = germanWordToInt(bWord);
    if (a !== null && b !== null) return `${kind} ${a}.${b}`;
    // Section context confirmed by the noun, but second part is gibberish
    // ("Beispiel zwei Punkt zwehaufneun") → unrecoverable.
    if (a !== null && b === null) rejected.push(match);
    return match;
  });

  // 2) Verbalized years back to digits.
  const yearRe =
    /\b(neunzehnhundert|achtzehnhundert|zweitausend)([a-zäöüß]+)\b/gi;
  result = result.replace(yearRe, (match, prefix: string, rest: string) => {
    const lower = prefix.toLowerCase();
    const century =
      lower === "neunzehnhundert" ? 1900
      : lower === "achtzehnhundert" ? 1800
      : 2000;
    const offset = germanWordToInt(rest);
    if (offset !== null && offset >= 0 && offset <= 99) {
      return String(century + offset);
    }
    rejected.push(match);
    return match;
  });

  // 3) "Seite 104 f." / "Seite 104 ff." → "Seite 104 und folgende".
  result = result.replace(
    /\b(Seite\s+\d+)\s*ff?\.\s*/g,
    "$1 und folgende ",
  );

  // 4) Garbled compound patterns that are flat-out unrecoverable.
  const garbledPatterns: RegExp[] = [
    // "zwehaufachtzig", "drehaufneun", "viehaufzehn" — fake digit-place
    // compounds (decimal-point readings gone wrong).
    /\b(?:zweh|dreh|vieh|fünh|siebh|neuh)auf[a-zäöüß]{2,}\b/gi,
    // "hundertvierf", "tausendvierf" — page reference cut at "f"
    // (lost the "olgende" suffix). The space-after variant is fixed
    // by rule 3 above; this catches the no-space version.
    /\b(?:hundert|tausend)[a-zäöüß]*vierf\b/gi,
    // Year-on-year jamming: "zweitausendelfteinundzwanzig",
    // "neunzehnhundertneunundneunzigzweitausend".
    /\b(?:zweitausend|neunzehnhundert|achtzehnhundert)[a-zäöüß]{15,}\b/gi,
  ];
  for (const re of garbledPatterns) {
    for (const m of result.matchAll(re)) rejected.push(m[0]);
  }

  // De-dup rejects so the retry feedback list isn't noisy.
  return { text: result, rejected: [...new Set(rejected)] };
}

/** Clear the cache — e.g. when the user changes the model override
 *  or manually edits the chapter text. */
export function clearAudioTextCache(chapterId: string): void {
  db()
    .prepare(
      "UPDATE chapters SET audio_text = NULL, audio_text_model = NULL WHERE id = ?"
    )
    .run(chapterId);
}

export function clearAudioTextCacheForDocument(documentId: string): void {
  db()
    .prepare(
      "UPDATE chapters SET audio_text = NULL, audio_text_model = NULL WHERE document_id = ?"
    )
    .run(documentId);
}
