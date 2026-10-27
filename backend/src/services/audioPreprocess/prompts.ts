// Prompt-Texte liegen als Markdown in src/prompts
import chapterDe from "../../prompts/audio-chapter.de.md" with { type: "text" };
import chapterEn from "../../prompts/audio-chapter.en.md" with { type: "text" };
import introDe from "../../prompts/audio-intro.de.md" with { type: "text" };
import introEn from "../../prompts/audio-intro.en.md" with { type: "text" };

export const SYSTEM_DE = chapterDe;
export const SYSTEM_EN = chapterEn;
export const INTRO_SYSTEM_DE = introDe;
export const INTRO_SYSTEM_EN = introEn;
