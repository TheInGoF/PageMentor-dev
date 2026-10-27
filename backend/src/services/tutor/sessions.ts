// Chat-Sitzungen und Nachrichten
import { randomUUID } from "node:crypto";
import { db } from "../../db";
import type { ChatMessageRow, ChatSessionRow } from "./types";


export function listChatSessions(): ChatSessionRow[] {
  return db()
    .prepare(
      `SELECT id, title, module_id, created_at, updated_at
         FROM chat_sessions
         ORDER BY updated_at DESC`
    )
    .all() as ChatSessionRow[];
}

export function createChatSession(moduleId: string | null): ChatSessionRow {
  const id = randomUUID();
  db()
    .prepare("INSERT INTO chat_sessions (id, module_id) VALUES (?, ?)")
    .run(id, moduleId);
  return db()
    .prepare("SELECT * FROM chat_sessions WHERE id = ?")
    .get(id) as ChatSessionRow;
}

export function getChatSession(id: string): ChatSessionRow | null {
  return (
    (db()
      .prepare("SELECT * FROM chat_sessions WHERE id = ?")
      .get(id) as ChatSessionRow | undefined) ?? null
  );
}

export function deleteChatSession(id: string): boolean {
  const res = db()
    .prepare("DELETE FROM chat_sessions WHERE id = ?")
    .run(id);
  return res.changes > 0;
}

export function renameChatSession(id: string, title: string): boolean {
  const res = db()
    .prepare(
      "UPDATE chat_sessions SET title = ?, updated_at = datetime('now') WHERE id = ?"
    )
    .run(title.trim().slice(0, 200), id);
  return res.changes > 0;
}

export function listChatMessages(sessionId: string): ChatMessageRow[] {
  // Gleicher Zeitstempel: user vor assistant, dann id
  return db()
    .prepare(
      `SELECT id, session_id, role, content, created_at
         FROM chat_messages
         WHERE session_id = ?
         ORDER BY created_at ASC,
                  CASE WHEN role = 'user' THEN 0 ELSE 1 END ASC,
                  id ASC`
    )
    .all(sessionId) as ChatMessageRow[];
}
