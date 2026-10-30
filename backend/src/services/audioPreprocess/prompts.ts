// Prompt-Texte: eigene Fassung aus den Einstellungen, sonst das Original (services/prompts.ts)
import { getPrompt } from "../prompts";

export const systemFor = (lang: string) => getPrompt(lang === "de" ? "audio-chapter.de" : "audio-chapter.en");
export const introSystemFor = (lang: string) => getPrompt(lang === "de" ? "audio-intro.de" : "audio-intro.en");
