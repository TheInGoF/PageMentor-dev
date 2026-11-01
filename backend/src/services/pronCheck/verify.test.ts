// Wortprüfung: Urteil über das Gehörte, Runden mit Stimme, Whisper und Gemma, Übernahme in die Liste
import { describe, expect, test } from "bun:test";
import type { HeardWord } from "./align";
import { judge, mergeVerified, verifyEntries, type VerifyDeps } from "./verify";

const heard = (s: string): HeardWord[] => s.split(" ").map((word, i) => ({ word, start: i, end: i + 1, prob: 0.9 }));

describe("Wortprüfung", () => {
  test("Urteil: Originalwort gehört ist ein Treffer, anderes Wort nicht, Gehörtes als Hinweis", () => {
    expect(judge("Qwen", heard("Das Wort heißt: Qwen."))).toEqual({ ok: true, heard: "Qwen" });
    expect(judge("Qwen", heard("Das Wort heißt Kwän."))).toEqual({ ok: false, heard: "Kwän" });
    // Whisper trennt das Wort, zusammen ist es dasselbe: Treffer
    expect(judge("Audiobookshelf", heard("Das Wort heißt: Audio Bookshelf"))).toMatchObject({ ok: true, heard: "Audio Bookshelf" });
    expect(judge("Docling", heard("Das Wort heißt: Doggling."))).toMatchObject({ ok: false, heard: "Doggling" });
  });

  test("Runden: Treffer wird erledigt, Fehlschlag bekommt neue Schreibweise, Rest bleibt offen mit bester Schreibweise", async () => {
    const spoken: string[] = [];
    // Ein Buchstabe daneben (Jemma) gilt wie in der Ausspracheprüfung als Schreibvariante von Whisper, also Treffer
    const answers: Record<string, string[]> = { Kwenn: ["Qwen"], "Audio-Buck-Schelf": ["Audio Buchschelf"], "Odio-Buck-Schelf": ["Audiobookshelf"], Dockling: ["Doggling"], "Dock-ling": ["Doglink"], "Dok-ling": ["Dogglin"] };
    const deps: VerifyDeps = {
      speak: async (text, idx) => {
        spoken.push(text);
        return `${idx}:${text}`;
      },
      hear: async (file) => {
        const spelling = file.replace(/^\d+:Das Wort heißt: /, "").replace(/\.$/, "");
        return heard(`Das Wort heißt: ${answers[spelling]?.[0] ?? "nichts"}.`);
      },
      improve: async (items) => new Map(items.map((i) => [i.from, i.from === "Audiobookshelf" ? "Odio-Buck-Schelf" : i.tried.length === 1 ? "Dock-ling" : "Dok-ling"])),
    };
    const list = [
      { from: "Qwen", to: "Kwenn" },
      { from: "Audiobookshelf", to: "Audio-Buck-Schelf" },
      { from: "Docling", to: "Dockling" },
      { from: "Team", to: "Tiem", checked: true },
    ];
    const { entries, result } = await verifyEntries(list, deps);
    expect(result).toEqual({ checked: 2, open: 1, rounds: 3 });
    expect(entries[0]).toEqual({ from: "Qwen", to: "Kwenn", checked: true });
    expect(entries[1]).toEqual({ from: "Audiobookshelf", to: "Odio-Buck-Schelf", checked: true });
    // Docling: dreimal gleich weit daneben; die erste Schreibweise bleibt, Gehörtes als Hinweis
    expect(entries[2]).toMatchObject({ from: "Docling", to: "Dockling", heard: "Doggling" });
    expect(entries[2].checked).toBeFalsy();
    // Erledigte werden nicht gesprochen
    expect(spoken.some((s) => s.includes("Tiem"))).toBe(false);
    expect(spoken).toHaveLength(3 + 2 + 1);
  });

  test("beschäftigte Grafikkarte: keine weitere Runde, nichts geht verloren", async () => {
    const deps: VerifyDeps = { speak: async () => "f", hear: async () => heard("Das Wort heißt: nein."), improve: async () => new Map(), busy: () => true };
    const { entries, result } = await verifyEntries([{ from: "Qwen", to: "Kwenn" }], deps);
    expect(result).toEqual({ checked: 0, open: 1, rounds: 0 });
    expect(entries[0]).toEqual({ from: "Qwen", to: "Kwenn" });
  });

  test("Übernahme: nur Einträge, die der Nutzer inzwischen nicht geändert hat", () => {
    const before = [{ from: "Qwen", to: "Kwenn" }, { from: "Gemma", to: "Dschemma" }];
    const after = [{ from: "Qwen", to: "Kwenn", checked: true }, { from: "Gemma", to: "Dschem-ma", heard: "Jemma" }];
    const current = [{ from: "Qwen", to: "Kwenn" }, { from: "Gemma", to: "Gämma" }, { from: "Neu", to: "Nju" }];
    expect(mergeVerified(current, before, after)).toEqual([{ from: "Qwen", to: "Kwenn", checked: true, heard: undefined }, { from: "Gemma", to: "Gämma" }, { from: "Neu", to: "Nju" }]);
  });
});
