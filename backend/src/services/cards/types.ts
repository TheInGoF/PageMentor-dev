// Grenzen und Typen der Kartenerzeugung

export const CHUNK_CHARS = 4000;
export const CHUNK_OVERLAP = 500;
export const MIN_CHAPTER_CHARS = 200;

export interface Card {
  question: string;
  answer: string;
}

export interface ChapterRow {
  id: string;
  number: number;
  title: string;
  text: string;
  start_page: number;
  sort_order: number;
  kind: string;
}
