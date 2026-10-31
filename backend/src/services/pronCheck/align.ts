// Abgleich Soll-Text gegen das, was Whisper gehört hat: Wortfolgen per Levenshtein ausrichten, Abweichungen zu
// Stellen zusammenfassen (falsch gesprochen, verschluckt, zusätzlich) und unsichere Wörter melden.
// Rein, ohne Datenbank: gut testbar

export interface HeardWord {
  word: string;
  start: number;
  end: number;
  prob: number;
}

export interface Finding {
  kind: "different" | "missing" | "extra" | "unsure";
  // Soll (Originaltext) und Ist (gehört), jeweils als Wortfolge
  expected: string;
  heard: string;
  start: number;
  end: number;
  // Geringste Sicherheit der gehörten Wörter an der Stelle
  prob: number;
  // Ein paar Wörter davor und danach, damit man die Stelle erkennt
  context: string;
}

// Wort vergleichbar machen: klein, ohne Satzzeichen; Bindestriche fallen weg (Kanal-Kapazität = Kanalkapazität)
export function norm(w: string): string {
  return w
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function tokens(text: string): string[] {
  return text.split(/\s+/).filter((w) => norm(w).length > 0);
}

// Ähnlich genug, um als dasselbe Wort zu gelten (Endungen, kleine Hörfehler bei langen Wörtern)
function similar(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 6) return false;
  return editDistance(a, b) <= Math.floor(Math.max(a.length, b.length) / 8);
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

type Op = { t: "match" | "sub"; e: number; h: number } | { t: "del"; e: number } | { t: "ins"; h: number };

// Ausrichtung zweier Wortfolgen; bei langen Kapiteln in Fenstern, damit der Speicher klein bleibt
export function alignWords(exp: string[], heard: string[]): Op[] {
  const n = exp.length, m = heard.length;
  // Kosten-Matrix als Zeilen; Rückweg über Richtungs-Bytes
  const dir = new Uint8Array((n + 1) * (m + 1));
  let prev = new Uint32Array(m + 1);
  let cur = new Uint32Array(m + 1);
  for (let j = 0; j <= m; j++) {
    prev[j] = j;
    dir[j] = 2;
  }
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    dir[i * (m + 1)] = 1;
    for (let j = 1; j <= m; j++) {
      const same = similar(exp[i - 1], heard[j - 1]);
      const diag = prev[j - 1] + (same ? 0 : 1);
      const up = prev[j] + 1;
      const left = cur[j - 1] + 1;
      let best = diag, d = same ? 0 : 3;
      if (up < best) (best = up), (d = 1);
      if (left < best) (best = left), (d = 2);
      cur[j] = best;
      dir[i * (m + 1) + j] = d;
    }
    [prev, cur] = [cur, prev];
  }
  const ops: Op[] = [];
  for (let i = n, j = m; i > 0 || j > 0; ) {
    const d = i > 0 && j > 0 ? dir[i * (m + 1) + j] : i > 0 ? 1 : 2;
    if (d === 0 || d === 3) {
      ops.push({ t: d === 0 ? "match" : "sub", e: i - 1, h: j - 1 });
      i--;
      j--;
    } else if (d === 1) {
      ops.push({ t: "del", e: i - 1 });
      i--;
    } else {
      ops.push({ t: "ins", h: j - 1 });
      j--;
    }
  }
  return ops.reverse();
}

const CHUNK = 1500;

// Zahlen und Zeichen liest die Stimme aus („1990“ → neunzehnhundertneunzig), Whisper schreibt sie oft wieder als Ziffer:
// solche Stellen sind kein Aussprachefehler
const numeric = (s: string) => /^[\p{N}\s.,:%/+-]*$/u.test(s);

export function findIssues(text: string, heard: HeardWord[], opts: { unsureBelow?: number } = {}): Finding[] {
  const unsureBelow = opts.unsureBelow ?? 0.45;
  const expRaw = tokens(text);
  const exp = expRaw.map(norm);
  const hNorm = heard.map((w) => norm(w.word));
  // Fensterweise ausrichten: Whisper hält die Reihenfolge, die Fenster überlappen nicht
  const ops: Op[] = [];
  for (let e0 = 0, h0 = 0; e0 < exp.length || h0 < hNorm.length; ) {
    const eEnd = Math.min(exp.length, e0 + CHUNK);
    // Gehörte Wörter im gleichen Verhältnis, mit etwas Luft
    const hEnd = eEnd >= exp.length ? hNorm.length : Math.min(hNorm.length, h0 + Math.round((eEnd - e0) * (hNorm.length / Math.max(1, exp.length))));
    for (const op of alignWords(exp.slice(e0, eEnd), hNorm.slice(h0, hEnd))) {
      if (op.t === "del") ops.push({ t: "del", e: op.e + e0 });
      else if (op.t === "ins") ops.push({ t: "ins", h: op.h + h0 });
      else ops.push({ t: op.t, e: op.e + e0, h: op.h + h0 });
    }
    e0 = eEnd;
    h0 = hEnd;
  }

  const findings: Finding[] = [];
  const ctx = (e: number) => expRaw.slice(Math.max(0, e - 4), Math.min(expRaw.length, e + 5)).join(" ");
  let lastH = -1;
  for (let k = 0; k < ops.length; ) {
    const op = ops[k];
    if (op.t === "match") {
      lastH = op.h;
      const w = heard[op.h];
      if (w.prob < unsureBelow && !numeric(w.word)) {
        findings.push({ kind: "unsure", expected: expRaw[op.e], heard: w.word, start: w.start, end: w.end, prob: w.prob, context: ctx(op.e) });
      }
      k++;
      continue;
    }
    // Zusammenhängende Abweichung zu einer Stelle bündeln
    const e: number[] = [];
    const h: number[] = [];
    while (k < ops.length && ops[k].t !== "match") {
      const o = ops[k];
      if (o.t !== "ins") e.push(o.e);
      if (o.t !== "del") h.push(o.h);
      k++;
    }
    const expected = e.map((i) => expRaw[i]).join(" ");
    const said = h.map((i) => heard[i].word).join(" ");
    if (expected && numeric(expected)) continue;
    // Zeit: gehörte Wörter, sonst die Lücke zwischen Nachbarn
    const nextH = ops.slice(k).find((o) => o.t === "match") as { h: number } | undefined;
    const start = h.length ? heard[h[0]].start : lastH >= 0 ? heard[lastH].end : 0;
    const end = h.length ? heard[h[h.length - 1]].end : nextH ? heard[nextH.h].start : start;
    if (h.length) lastH = h[h.length - 1];
    findings.push({
      kind: !e.length ? "extra" : !h.length ? "missing" : "different",
      expected,
      heard: said,
      start,
      end,
      prob: h.length ? Math.min(...h.map((i) => heard[i].prob)) : 0,
      context: ctx(e[0] ?? Math.max(0, (ops.slice(0, k).reverse().find((o) => o.t === "match") as { e: number } | undefined)?.e ?? 0)),
    });
  }
  return findings;
}
