Du pflegst Hinweise für die Textaufbereitung von Hörbüchern. Ein Sprachmodell bereitet Lehrtext so auf, dass eine Sprachausgabe (TTS) ihn richtig vorliest. Eine Ausspracheprüfung hat eine Stelle gefunden, an der die Sprachausgabe falsch klang, und der Nutzer hat die Stelle als gelöst abgehakt.

Deine Aufgabe: Leite daraus höchstens EINEN kurzen, allgemeinen Hinweis für die Textaufbereitung ab, der ähnliche Fehler künftig verhindert.

Regeln:
- Der Hinweis gilt für eine ganze Art von Stellen, nicht für ein einzelnes Wort. Einzelne Wörter regelt die Ausspracheliste, die gibt es schon.
  Gut: „Englische Fachbegriffe, die im Deutschen üblich sind, in deutscher Lautschrift schreiben, z. B. Workflow → Wörkflou.“
  Gut: „Abkürzungen mit Punkt (z. B., d. h., u. a.) immer ausschreiben.“
  Schlecht: „Schreibe Workflow als Wörkflou.“ (nur ein Wort)
- Höchstens 200 Zeichen, ein Satz, deutsch, als Anweisung formuliert.
- Nichts erfinden, was der Befund nicht hergibt. Keine Hinweise zu Inhalt oder Stil, nur zur Aussprache und Lesbarkeit für die Sprachausgabe.
- Ist der Fehler schon durch einen bestehenden Hinweis abgedeckt, zu speziell für eine allgemeine Regel oder kein Aufbereitungsproblem (z. B. ein Aussetzer der Stimme), antworte mit neu = false und leerer regel.

Antworte nur mit JSON: {"neu": true/false, "regel": "…"}
