// Liest JavaScript-Literale (Arrays, Objekte, Strings, Zahlen) ohne sie auszuführen
// Für Daten, die in fremden HTML-Dateien als const X = [...] stehen

export class JsLiteralError extends Error {}

export function parseJsLiteral(src: string): unknown {
  let i = 0;
  const fail = (msg: string): never => {
    throw new JsLiteralError(`${msg} an Stelle ${i}: ${src.slice(i, i + 30)}`);
  };
  const skip = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src.startsWith("//", i)) i = src.indexOf("\n", i) === -1 ? src.length : src.indexOf("\n", i);
      else if (src.startsWith("/*", i)) i = src.indexOf("*/", i) === -1 ? fail("Kommentar offen") : src.indexOf("*/", i) + 2;
      else return;
    }
  };
  const str = (): string => {
    const q = src[i++];
    let out = "";
    while (i < src.length && src[i] !== q) {
      if (src[i] === "\\") {
        const c = src[++i];
        const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", "0": "\0" };
        if (c === "u") {
          out += String.fromCharCode(parseInt(src.slice(i + 1, i + 5), 16));
          i += 5;
          continue;
        }
        out += map[c] ?? c;
        i++;
      } else out += src[i++];
    }
    if (src[i] !== q) fail("String offen");
    i++;
    return out;
  };
  const value = (): unknown => {
    skip();
    const c = src[i];
    if (c === "[") {
      i++;
      const arr: unknown[] = [];
      for (;;) {
        skip();
        if (src[i] === "]") return i++, arr;
        arr.push(value());
        skip();
        if (src[i] === ",") i++;
        else if (src[i] !== "]") fail("Komma oder ] erwartet");
      }
    }
    if (c === "{") {
      i++;
      const obj: Record<string, unknown> = {};
      for (;;) {
        skip();
        if (src[i] === "}") return i++, obj;
        let key: string;
        if (src[i] === "'" || src[i] === '"') key = str();
        else {
          const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
          if (!m) fail("Schlüssel erwartet");
          key = m![0];
          i += key.length;
        }
        skip();
        if (src[i++] !== ":") fail(": erwartet");
        obj[key] = value();
        skip();
        if (src[i] === ",") i++;
        else if (src[i] !== "}") fail("Komma oder } erwartet");
      }
    }
    if (c === "'" || c === '"') return str();
    const m = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(src.slice(i));
    if (!m) fail("Wert erwartet");
    i += m![0].length;
    return m![0] === "true" ? true : m![0] === "false" ? false : m![0] === "null" ? null : Number(m![0]);
  };
  const v = value();
  skip();
  return v;
}

// Wert einer Konstanten aus Quelltext: const NAME = <Literal>;
export function extractConst(source: string, name: string): unknown {
  const start = new RegExp(`const\\s+${name}\\s*=\\s*`).exec(source);
  if (!start) return undefined;
  const from = start.index + start[0].length;
  // Literal endet am passenden Klammerende; Strings und Kommentare überspringen
  let depth = 0;
  let i = from;
  for (; i < source.length; i++) {
    const c = source[i];
    if (c === "'" || c === '"' || c === "`") {
      const q = c;
      for (i++; i < source.length && source[i] !== q; i++) if (source[i] === "\\") i++;
    } else if (source.startsWith("//", i)) i = source.indexOf("\n", i);
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return parseJsLiteral(source.slice(from, i + 1));
}
