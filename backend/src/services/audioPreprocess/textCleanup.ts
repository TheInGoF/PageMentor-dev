// Deterministische Text-Reparaturen vor und nach dem LLM-Lauf

// Abschnittsnummern am Absatzanfang entfernen: "4.6 Titel" → "Titel"
// - nur mehrstufig (4.6, 4.6.1), einfache Zahlen bleiben: Jahr oder Listenpunkt
// - nur am Zeilenanfang, Querverweise im Satz bleiben
// - idempotent
export function stripLeadingSectionNumbers(text: string): string {
  return text.replace(
    /^[ \t]*\d+(?:\.\d+){1,3}\.?[ \t]+(?=[A-ZÄÖÜ])/gm,
    ""
  );
}

// Text in Stücke ≤ maxChars teilen
// - bevorzugt an Absätzen, sonst an Satzenden
// - überlanger Einzelsatz bleibt ganz
export function splitForPreprocess(text: string, maxChars: number): string[] {
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

// Meta-Kommentare kleiner LLMs entfernen
// - Code-Fences, Vorspann "Hier ist …", Änderungslisten am Ende
// - mehrdeutige Köpfe wie "Hinweis:" nur mit Bearbeitungs-Vokabular
// - geschnitten wird nur im letzten Fünftel, min. 500 Zeichen
export function stripWrappers(s: string): string {
  let t = s.trim();
  t = t.replace(/^```(?:[a-zA-Z]+)?\n/, "").replace(/\n```$/, "");
  t = t.replace(
    /^(here is|hier ist|hier folgt|der überarbeitete text|the cleaned text|cleaned text|bereinigter text)[^\n]*\n+/i,
    ""
  );

  // Optionale Trennlinie, dann optionaler Markdown-Kopf
  const headPart = "\\n+(?:-{3,}\\s*\\n+)?(?:#{1,6}\\s*|\\*\\*\\s*)?";
  // Doppelpunkt, Zeilenende oder Bold-Ende; Schnitt per slice
  const tailPart = "(?:\\*?\\s*:|\\s*\\n|\\s*\\*\\*)";
  const unambiguous = [
    "Änderungen",
    "Änderungsliste",
    "Bearbeitungen",
    "Vorgenommene\\s+Änderungen",
    "Zusammenfassung\\s+der\\s+Änderungen",
    "Meine\\s+Bearbeitungen",
    "Ich\\s+habe\\s+(?:folgende|die\\s+folgenden|hier\\s+)?(?:Änderungen|Anpassungen|Bearbeitungen)",
    "Edit\\s*list",
    "Changes",
    "Modifications",
    "Summary\\s+of\\s+changes",
    "I\\s+(?:made|have\\s+made|performed)\\s+the\\s+following",
  ].join("|");
  const ambiguous = ["Anmerkung", "Anmerkungen", "Hinweis", "Hinweise", "Notes?"].join("|");
  const editVocab =
    /(geändert|angepasst|umformuliert|entfernt|ersetzt|gestrichen|bereinigt|changed|removed|replaced|reworded|rewrote|edited)/i;

  const tailWindowStart = Math.max(0, t.length - Math.max(500, Math.floor(t.length / 5)));
  const unambiguousRe = new RegExp(`${headPart}(?:${unambiguous})${tailPart}`, "ig");
  const ambiguousRe = new RegExp(`${headPart}(?:${ambiguous})${tailPart}`, "ig");

  // Letzter Treffer im Endbereich, Treffer im Fließtext zählen nicht
  const lastTailMatch = (re: RegExp): RegExpExecArray | null => {
    let best: RegExpExecArray | null = null;
    for (const m of t.matchAll(re)) {
      if (m.index !== undefined && m.index >= tailWindowStart) {
        best = m as RegExpExecArray;
      }
    }
    return best;
  };

  const um = lastTailMatch(unambiguousRe);
  if (um) {
    t = t.slice(0, um.index);
  } else {
    const am = lastTailMatch(ambiguousRe);
    if (am && am.index !== undefined && editVocab.test(t.slice(am.index))) {
      t = t.slice(0, am.index);
    }
  }
  return t.trim();
}

// Überschrift + erster Satz auf einer Zeile wieder trennen
// "1.4 Dienstleistung. Der Begriff …" → Absatz nach der Überschrift
export function restoreHeadingParagraphs(text: string): string {
  return text.replace(
    /^(\d+(?:\.\d+){0,3}\s+[A-ZÄÖÜ][^\n.]{2,80}\.)\s+(?=[A-ZÄÖÜ])/gm,
    "$1\n\n"
  );
}
