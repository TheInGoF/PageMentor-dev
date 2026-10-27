// Fehlversuche der lokalen KI merken: Eingabe, Ausgabe, Fehler; Grundlage für die Diagnose
import { db } from "../../db";

const KEEP = 50;

export interface Failure {
  id: number;
  kind: string;
  model: string | null;
  input: string;
  output: string;
  error: string | null;
  created_at: string;
}

export function recordFailure(kind: string, model: string | null, input: string, output: string, error: string | null): void {
  try {
    db().prepare("INSERT INTO llm_failures (kind, model, input, output, error) VALUES (?, ?, ?, ?, ?)").run(kind, model, input.slice(0, 20_000), output.slice(0, 20_000), error);
    db().prepare("DELETE FROM llm_failures WHERE id NOT IN (SELECT id FROM llm_failures ORDER BY id DESC LIMIT ?)").run(KEEP);
  } catch {
    // Protokoll darf die eigentliche Arbeit nie stören
  }
}

export function listFailures(): Array<Omit<Failure, "input" | "output"> & { inputChars: number }> {
  return db().prepare("SELECT id, kind, model, error, created_at, length(input) AS inputChars FROM llm_failures ORDER BY id DESC").all() as Array<Omit<Failure, "input" | "output"> & { inputChars: number }>;
}

export function getFailure(id: number): Failure | null {
  return (db().prepare("SELECT * FROM llm_failures WHERE id = ?").get(id) as Failure) ?? null;
}
