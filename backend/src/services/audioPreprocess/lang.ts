// Zweisprachige Lehrbücher: fremdsprachige Passagen mit [es]…[/es] markieren, damit das Hörbuch die Stimme wechselt.
// Gemma markiert abschnittsweise; danach muss der Text ohne Markierungen wortgleich sein, sonst gilt eine
// einfache Erkennung (¿ ¡ ñ, Akzente). Ergebnis mit Stempel in chapters.audio_lang_text.
import { createHash } from "crypto";
import { db } from "../../db";
import { generate } from "../llm";
import { withGemmaLock } from "../gemmaLock";
import { getPrompt } from "../prompts";
import { PIPELINE_VERSION } from "../stamps";

const NAMES: Record<string, string> = { es: "Spanisch", en: "Englisch", fr: "Französisch", it: "Italienisch" };
const PIECE = 1500;

const strip = (s: string) => s.replace(/\[\/?[a-z]{2}\]/g, "").replace(/\s+/g, " ").trim();

export function langStamp(text: string, lang: string): string {
  return createHash("sha256").update(`${PIPELINE_VERSION.gemma}|${lang}|${getPrompt("audio-lang.de")}|${text}`).digest("hex").slice(0, 16);
}

// Ersatz ohne Gemma: Zeilen mit typisch spanischen Zeichen und ohne deutsche Umlaute
export function heuristicTag(text: string, lang: string): string {
  if (lang !== "es") return text;
  return text
    .split("\n")
    .map((l) => (l.trim() && /[¿¡ñáéíóú]/i.test(l) && !/[äöüß]/i.test(l) ? `[es]${l.trim()}[/es]` : l))
    .join("\n");
}

// Absätze zu Stücken bis ~1500 Zeichen bündeln, damit Gemma den Zusammenhang sieht
function pieces(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (const p of text.split(/\n{2,}/)) {
    if (buf && buf.length + p.length > PIECE) {
      out.push(buf);
      buf = "";
    }
    buf = buf ? `${buf}\n\n${p}` : p;
  }
  if (buf) out.push(buf);
  return out;
}

async function tagPiece(piece: string, lang: string, model?: string): Promise<string> {
  const system = getPrompt("audio-lang.de").replaceAll("{SPRACHE}", NAMES[lang] ?? lang).replaceAll("{CODE}", lang);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await generate({ prompt: piece, system, model, options: { temperature: 0, num_ctx: 8192, num_predict: 4096 } });
      const out = r.response?.trim() ?? "";
      if (out && strip(out) === strip(piece)) return out;
      console.warn(`[audio-lang] Versuch ${attempt + 1}: Gemma hat den Text verändert, verworfen`);
    } catch (err) {
      console.warn(`[audio-lang] Gemma-Fehler:`, err instanceof Error ? err.message : err);
    }
  }
  return heuristicTag(piece, lang);
}

// Markierten Text für ein Kapitel: aus dem Cache, wenn Text und Anweisung gleich geblieben sind
export async function tagChapterLanguages(chapterId: string, text: string, lang: string, model?: string): Promise<string> {
  const stamp = langStamp(text, lang);
  const row = db().prepare("SELECT audio_lang_text, audio_lang_stamp FROM chapters WHERE id = ?").get(chapterId) as
    | { audio_lang_text: string | null; audio_lang_stamp: string | null }
    | undefined;
  if (row?.audio_lang_text && row.audio_lang_stamp === stamp) return row.audio_lang_text;
  const tagged = await withGemmaLock(`lang ${chapterId.slice(0, 8)}`, async () => {
    const out: string[] = [];
    for (const p of pieces(text)) out.push(await tagPiece(p, lang, model));
    return out.join("\n\n");
  });
  db().prepare("UPDATE chapters SET audio_lang_text = ?, audio_lang_stamp = ? WHERE id = ?").run(tagged, stamp, chapterId);
  return tagged;
}
