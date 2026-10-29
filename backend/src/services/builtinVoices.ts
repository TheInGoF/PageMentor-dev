// Mitgelieferte deutsche Vorlage-Stimmen, frei lizenziert: damit F5-TTS und TADA (klonen nur) ab dem
// ersten Start Stimmen haben. Einmal je Stimme als normale Stimmprobe angelegt; wer sie löscht, behält das
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { APP_DIR, PUBLIC_DIR } from "../paths";
import { profileValue, setProfileValue } from "../study/progress";
import { createVoiceSample } from "./voiceSamples";
import { emitLog } from "../log/logger";

interface BuiltinVoice {
  id: string;
  file: string;
  label: string;
  gender: "female" | "male";
  // Exakter Wortlaut der Aufnahme, für gutes Klonen
  text: string;
}

// Herkunft und Lizenz: frontend/public/voices/LIZENZ.md
export const BUILTIN_VOICES: BuiltinVoice[] = [
  {
    id: "thorsten",
    file: "thorsten.wav",
    label: "Thorsten (Vorlage)",
    gender: "male",
    text: "Der Schutz der Menschen vor Hochwasser ist eine gesellschaftliche Daueraufgabe. Die Trinkwassernachfrage hat sich in den letzten Jahren stetig erhöht.",
  },
  {
    id: "hokuspokus",
    file: "hokuspokus.wav",
    label: "Hokuspokus (Vorlage)",
    gender: "female",
    text: "Dann ging sie durch die Kammern des Hauses nach den Wandschränken, wo die Kleider gefaltet in großen Lacktruhen lagen.",
  },
];

// Im Paket unter public/voices, in der Entwicklung im Frontend-Ordner
function voiceFile(name: string): string | null {
  for (const dir of [join(PUBLIC_DIR, "voices"), join(APP_DIR, "..", "frontend", "public", "voices")]) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

export async function seedBuiltinVoices(): Promise<number> {
  let added = 0;
  for (const v of BUILTIN_VOICES) {
    const key = `builtin_voice_${v.id}`;
    if (profileValue(key)) continue;
    const path = voiceFile(v.file);
    if (!path) continue;
    try {
      await createVoiceSample({ label: v.label, gender: v.gender, language: "de", refText: v.text, filename: v.file, bytes: readFileSync(path) });
      setProfileValue(key, "1");
      added++;
    } catch (err) {
      emitLog("warn", "tts", `Vorlage-Stimme ${v.label} nicht angelegt`, { err });
    }
  }
  if (added) emitLog("info", "tts", `${added} Vorlage-Stimmen angelegt (für F5-TTS und TADA)`);
  return added;
}
