// Mitgelieferte Vorlage-Stimmen, frei lizenziert: damit F5-TTS und TADA (klonen nur) ab dem ersten Start
// Stimmen haben, je Sprache weiblich und männlich. Einmal je Stimme als normale Stimmprobe angelegt; wer sie löscht, behält das
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
  language: string;
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
    language: "de",
    text: "Der Schutz der Menschen vor Hochwasser ist eine gesellschaftliche Daueraufgabe. Die Trinkwassernachfrage hat sich in den letzten Jahren stetig erhöht.",
  },
  {
    id: "hokuspokus",
    file: "hokuspokus.wav",
    label: "Hokuspokus (Vorlage)",
    gender: "female",
    language: "de",
    text: "Dann ging sie durch die Kammern des Hauses nach den Wandschränken, wo die Kleider gefaltet in großen Lacktruhen lagen.",
  },
  {
    id: "lucia",
    file: "lucia.wav",
    label: "Lucía (Vorlage)",
    gender: "female",
    language: "es",
    text: "Si te mareas fácil en un barco, puedes llegar por tierra ya que no es una isla, sino una península. Tienes muchas opciones si te interesa la fotografía.",
  },
  {
    id: "tux-es",
    file: "tux.wav",
    label: "Tux (Vorlage)",
    gender: "male",
    language: "es",
    text: "El gentío aumentaba en todas partes, y especialmente en la plaza de San Antonio. Mira, salen algunos con un carro para ir a casa del abastecedor en busca de las provisiones.",
  },
  {
    id: "libritts-2035",
    file: "libritts-2035.wav",
    label: "Clara (Vorlage)",
    gender: "female",
    language: "en",
    text: "The barren rock, about three miles in length, was covered with monastic buildings, and its cemetery was already adorned with the tombs of saints and kings.",
  },
  {
    id: "libritts-2803",
    file: "libritts-2803.wav",
    label: "Arthur (Vorlage)",
    gender: "male",
    language: "en",
    text: "And so through many questions, and many experiments, they learn at last how to use the contents of this one storehouse.",
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
      await createVoiceSample({ label: v.label, gender: v.gender, language: v.language, refText: v.text, filename: v.file, bytes: readFileSync(path) });
      setProfileValue(key, "1");
      added++;
    } catch (err) {
      emitLog("warn", "tts", `Vorlage-Stimme ${v.label} nicht angelegt`, { err });
    }
  }
  if (added) emitLog("info", "tts", `${added} Vorlage-Stimmen angelegt (für F5-TTS und TADA)`);
  return added;
}
