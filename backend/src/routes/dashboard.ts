import { Hono } from "hono";
import { db } from "../db";

export const dashboardRoutes = new Hono();

interface DailyReview {
  date: string;
  count: number;
  avgQuality: number;
}

interface WeakTopic {
  chapter_id: string;
  chapter_title: string;
  chapter_number: number;
  document_id: string;
  document_title: string;
  low_quality_count: number;
  avg_ease: number;
}

dashboardRoutes.get("/", (c) => {
  const d = db();

  const totals = d
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM documents) as documents,
         (SELECT COUNT(*) FROM cards) as cards,
         (SELECT COUNT(*) FROM cards c
          LEFT JOIN progress p ON p.card_id = c.id
          WHERE (p.next_review IS NULL OR p.next_review <= datetime('now'))) as due,
         (SELECT COUNT(*) FROM cards c JOIN progress p ON p.card_id = c.id
          WHERE p.reps >= 2) as learned,
         (SELECT COUNT(*) FROM audio WHERE status = 'done') as audio_done,
         (SELECT COUNT(*) FROM exam_sessions WHERE status = 'closed') as exams,
         (SELECT COALESCE(AVG(score), 0) FROM exam_sessions WHERE status = 'closed') as exam_avg_score
       `
    )
    .get() as {
    documents: number;
    cards: number;
    due: number;
    learned: number;
    audio_done: number;
    exams: number;
    exam_avg_score: number;
  };

  // Daily review activity over the last 30 days.
  const dailyRows = d
    .prepare(
      `SELECT date(last_seen) as date, COUNT(*) as count
       FROM progress
       WHERE last_seen >= date('now', '-30 days')
       GROUP BY date(last_seen)
       ORDER BY date ASC`
    )
    .all() as Array<{ date: string; count: number }>;

  // Fill missing days for a continuous chart.
  const activity: DailyReview[] = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const day = new Date(today);
    day.setDate(day.getDate() - i);
    const iso = day.toISOString().slice(0, 10);
    const row = dailyRows.find((r) => r.date === iso);
    activity.push({ date: iso, count: row?.count ?? 0, avgQuality: 0 });
  }

  // Streak: consecutive days ending today (or yesterday) with activity.
  const activeDates = new Set(dailyRows.map((r) => r.date));
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const day = new Date(today);
    day.setDate(day.getDate() - i);
    const iso = day.toISOString().slice(0, 10);
    if (activeDates.has(iso)) streak++;
    else if (i > 0) break;
    // Allow today to be blank without breaking the streak (if yesterday had activity).
    else if (i === 0 && !activeDates.has(iso)) continue;
  }

  // Weak topics: chapters where many cards have low ease or failing reps.
  const weak = d
    .prepare(
      `SELECT c.chapter_id, ch.title as chapter_title, ch.number as chapter_number,
              c.document_id, d.title as document_title,
              COUNT(*) as low_quality_count,
              COALESCE(AVG(p.ease), 2.5) as avg_ease
       FROM cards c
       JOIN progress p ON p.card_id = c.id
       JOIN chapters ch ON ch.id = c.chapter_id
       JOIN documents d ON d.id = c.document_id
       WHERE p.ease < 2.2 OR p.streak = 0
       GROUP BY c.chapter_id
       HAVING low_quality_count >= 2
       ORDER BY low_quality_count DESC, avg_ease ASC
       LIMIT 5`
    )
    .all() as WeakTopic[];

  // Recently uploaded documents.
  const recent = d
    .prepare(
      `SELECT id, title, type, page_count, ocr_status, created_at
       FROM documents
       ORDER BY created_at DESC
       LIMIT 5`
    )
    .all();

  return c.json({
    totals,
    streak,
    activity,
    weakTopics: weak,
    recent,
  });
});
