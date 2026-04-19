/**
 * Audio-Preprocessor.
 *
 * Bereitet einen Kapiteltext für TTS vor — alles raus, was gesprochen
 * keinen Sinn ergibt oder Hörer beim Autofahren wegrutschen lässt:
 *
 *   - Abkürzungen ausschreiben (z. B. → "zum Beispiel", vgl. → "vergleiche")
 *   - Zahlen und Einheiten verbalisieren (§ 12 → "Paragraph zwölf",
 *     5 kg/m² → "fünf Kilogramm pro Quadratmeter")
 *   - Formeln in sprechbare Form (f(x) = x² → "f von x gleich x Quadrat")
 *   - Inline-Citations entfernen oder umformulieren ((Müller 2023, S. 42)
 *     → entweder weg oder "laut Müller")
 *   - Aufzählungs-Marker raus (• – * 1. 2. 3.) — gesprochen nervt das,
 *     besser durch natürliche Sprachübergänge ersetzen
 *   - Code-Blöcke und URLs sinnvoll ankündigen
 *   - Griechische Buchstaben und Sonderzeichen ausschreiben
 *
 * Wichtig: der Inhalt darf NICHT verändert werden. Keine Auslassungen,
 * keine Umformulierungen, keine Vereinfachungen — nur Form.
 *
 * Pro Kapitel einmal, dann gecached in `chapters.audio_text`. Bei
 * Re-Extraktion via Docling werden alle Kapitel-Rows ersetzt → Cache
 * fällt natürlich raus.
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
- Pausen entstehen ausschließlich durch Satzzeichen: Punkt = lange Pause, Strichpunkt = mittlere Pause, Komma = kurze Pause. Setze diese gezielt, wo das Verständnis sonst leidet (lange Aufzählungen, eingeschobene Definitionen, Formel-Erklärungen).

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
- Dezimalzahlen mit Komma: "0,5" lassen — Kokoro liest "null Komma fünf".
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
- Kurze Aufzählungen in einen Satz pressen mit "Erstens, … Zweitens, … Drittens, …" oder Kommas/Semikolons.
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
- Setze Punkte ein, wo der Satz sonst zu lang wird — Faustregel: maximal 25–30 Wörter pro Satz.
- Setze Kommas vor erklärenden Nebensätzen ("die Energie, die im System steckt, …").
- Verwende Doppelpunkt vor wichtigen Definitionen oder Aufzählungen — gibt eine spürbare Pause.
- Bindestriche zwischen Wörtern entfernen (Zeilenumbruch-Trennung), zwischen Worten und Begriffen ("S-Kurve") behalten.
- Anführungszeichen entfernen, wenn sie nur für Hervorhebung stehen — TTS liest sie nicht aus, sie können aber den Rhythmus stören.

================================================================
11. INHALTLICHE INVARIANTEN
================================================================
- KEINE Auslassung von Inhalt. Jeder Satz, jede Definition, jeder Sachverhalt im Original muss im Output erhalten sein.
- KEINE Vereinfachung der Aussagen — nur der Form, nicht des Inhalts.
- KEINE Ergänzung von eigenem Wissen oder Erklärungen, die nicht im Original stehen.
- Behalte die Reihenfolge der Sätze.
- Behalte die Absatzstruktur (doppelte Zeilenumbrüche zwischen Absätzen).
- Schreibe in derselben Sprache wie das Original (Deutsch bleibt Deutsch).

================================================================
12. ANTWORTFORMAT
================================================================
- Gib NUR den umgeformten Text zurück.
- KEINE Einleitung ("Hier ist der bereinigte Text…" etc.).
- KEINE Erklärung oder Meta-Kommentare zu deiner Arbeit.
- KEINE Änderungsliste, KEINE Zusammenfassung der Bearbeitungen, KEIN "Anmerkung:"-Block, KEIN "Hinweis:"-Block, KEIN "Ich habe Folgendes geändert…".
- KEINE horizontale Trennlinie ("---") gefolgt von einer Erklärung.
- KEIN Markdown, KEINE Überschriften, KEINE Code-Fences, KEINE Bulletpoints am Ende.
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
- Pauses come from punctuation alone: period = long pause, semicolon = medium pause, comma = short pause. Place these deliberately where understanding would otherwise suffer (long enumerations, embedded definitions, formula explanations).

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
- Insert periods to break long sentences — rule of thumb: max 25–30 words per sentence.
- Use commas before explanatory subordinate clauses ("the energy, that is stored in the system, …").
- Use a colon before key definitions or enumerations — gives a noticeable pause.
- Strip soft hyphens (line-break hyphenation), keep meaningful compound hyphens ("S-curve").
- Drop quotation marks used only for emphasis — TTS doesn't speak them and they disrupt rhythm.

================================================================
11. CONTENT INVARIANTS
================================================================
- NO content omission. Every sentence, definition, fact in the original must be present in the output.
- NO simplification of statements — only of form, not content.
- NO addition of your own knowledge or explanations not in the original.
- Preserve sentence order.
- Preserve paragraph structure (double newlines between paragraphs).
- Write in the same language as the input (English stays English).

================================================================
12. RESPONSE FORMAT
================================================================
- Return ONLY the rewritten text.
- NO preface ("Here is the cleaned text…" etc.).
- NO explanation or meta commentary about your work.
- NO change list, NO summary of edits, NO "Note:" block, NO "Changes:" block, NO "I made the following changes…".
- NO horizontal rule ("---") followed by an explanation.
- NO markdown, NO headings, NO code fences, NO bullet points at the end.
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
 * Liefert den TTS-tauglichen Text eines Kapitels. Cache-Hit returnt
 * sofort, sonst LLM-Call und Persist. Wenn kein LLM verfügbar ist,
 * fällt der Caller auf den Original-`text` zurück (Caller entscheidet).
 */
export async function preprocessChapterForAudio(params: {
  chapterId: string;
  language: string;
  /** Optional: Modell-Override. Sonst wird das Default-Modell des aktuellen
   *  Providers genutzt. */
  model?: string;
  /** Cache ignorieren und neu generieren (z. B. nach Modell-Wechsel). */
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

  // Deterministische Pre-Pass: Standard-Abkürzungen, Einheiten,
  // Symbole, Datum/Uhrzeit. Spart dem LLM ~150 Regex-Regeln die er
  // sonst selbst anwenden müsste. Der Prompt wurde angepasst — er
  // weiß jetzt dass diese Transformationen schon durch sind und soll
  // sie nicht rückgängig machen (z. B. „zum Beispiel" NICHT wieder
  // zu „z. B." verkürzen).
  const pretreated = expandAbbreviations(row.text, params.language);

  const system = params.language === "de" ? SYSTEM_DE : SYSTEM_EN;
  const result = await generate({
    prompt: pretreated,
    system,
    model: params.model,
    options: { temperature: 0.1, top_p: 0.9 },
  });

  const cleaned = restoreHeadingParagraphs(stripWrappers(result.response));
  if (!cleaned || cleaned.length < 20) {
    throw new Error(
      `Preprocessor returned suspiciously short output (${cleaned.length} chars) — falling back to original`
    );
  }

  d.prepare(
    "UPDATE chapters SET audio_text = ?, audio_text_model = ? WHERE id = ?"
  ).run(cleaned, result.model, params.chapterId);

  return { text: cleaned, model: result.model, cached: false };
}

/** Kleinere LLMs halten sich trotz expliziter Anweisung nicht immer
 *  an "nur den Text, keine Meta-Kommentare" — sie packen gerne:
 *    - Code-Fences um den Output
 *    - "Hier ist der bereinigte Text:"-Vorwort
 *    - Am Ende eine "Änderungsliste" / "Edit summary" / "Ich habe
 *      folgendes gemacht: …" mit Bullet-Aufzählung
 *
 *  Das schneidet das deterministisch wieder weg. Der System-Prompt
 *  verbietet es auch explizit — beides zusammen fängt ~99% der Fälle
 *  ab. */
function stripWrappers(s: string): string {
  let t = s.trim();
  // Code-Fences entfernen.
  t = t.replace(/^```(?:[a-zA-Z]+)?\n/, "").replace(/\n```$/, "");
  // Häufige Vorworte abschneiden, falls sie auf eigener Zeile stehen.
  t = t.replace(
    /^(here is|hier ist|hier folgt|der überarbeitete text|the cleaned text|cleaned text|bereinigter text)[^\n]*\n+/i,
    ""
  );
  // Trailing Edit-Listen / Meta-Kommentare am Ende abschneiden.
  // Match ab der ersten Zeile die wie Meta-Header aussieht bis EOF.
  // Typische Trigger:
  //   "---" als Trenner vor einer Erklärung
  //   "### Änderungen", "**Hinweis:**", "Änderungen:", "Changes:" …
  //   "Ich habe folgendes / die folgenden …"
  //   "Note:", "Notes:", "Anmerkung:"
  const metaHeaderRe = new RegExp(
    // optional: horizontale Trennlinie auf eigener Zeile
    "\\n+(?:-{3,}\\s*\\n+)?" +
      // optional Markdown-Heading/Bold-Marker
      "(?:#{1,6}\\s*|\\*\\*\\s*)?" +
      // das eigentliche Signalwort (case-insensitive)
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
      // Doppelpunkt oder Stern oder Newline nach dem Signalwort
      "(?:\\*?\\s*:|\\s*\\n|\\s*\\*\\*)" +
      // Alles bis EOF
      "[\\s\\S]*$",
    "i"
  );
  t = t.replace(metaHeaderRe, "");
  return t.trim();
}

/** Manche Modelle (gerade kleinere wie Gemma) ignorieren die
 *  „Absatz-Struktur erhalten"-Regel und ziehen Heading + erster
 *  Body-Satz auf eine Zeile zusammen. Beispiel:
 *
 *    Input:  "1.4 Dienstleistung.\n\nDer Begriff …"
 *    Output: "1.4 Dienstleistung. Der Begriff …"
 *
 *  Heuristik macht das rückgängig: nummerierter Heading-Pattern
 *  (Sub-Section-Notation, Großbuchstabe, Punkt am Ende) gefolgt
 *  von einem Großbuchstaben → Absatz-Newline einschieben. */
function restoreHeadingParagraphs(text: string): string {
  return text.replace(
    // Match: "<num>.<num> Capitalized Title.<space><Capital>"
    // Group 1 = die Heading-Phrase inkl. Punkt
    // Lookahead = Großbuchstabe als Start des nächsten Satzes
    /^(\d+(?:\.\d+){0,3}\s+[A-ZÄÖÜ][^\n.]{2,80}\.)\s+(?=[A-ZÄÖÜ])/gm,
    "$1\n\n"
  );
}

/** Cache leeren — z. B. wenn der User den Modell-Override ändert oder
 *  manuell den Kapiteltext editiert hat. */
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
