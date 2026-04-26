/**
 * SuperMemo-2 algorithm for spaced repetition.
 *
 * We map the three UI buttons to SM-2 quality levels:
 *   forgot   → quality 1  (must be relearned from scratch)
 *   partial  → quality 3  (recalled, but with effort)
 *   known    → quality 5  (recalled instantly)
 *
 * Ease can't drop below 1.3. Intervals are in days, but for the next
 * review of just-failed cards we use minutes (10 min) so they come
 * back in the same session.
 */

export type Quality = 1 | 3 | 5;

export interface ProgressState {
  ease: number;
  reps: number;
  streak: number;
  lastSeenAt: Date;
  nextReviewAt: Date;
}

const MIN_EASE = 1.3;

export function initialState(now: Date = new Date()): ProgressState {
  return {
    ease: 2.5,
    reps: 0,
    streak: 0,
    lastSeenAt: now,
    nextReviewAt: now,
  };
}

export function updateProgress(prev: ProgressState, quality: Quality, now: Date = new Date()): ProgressState {
  // New ease regardless of pass/fail
  const q = quality;
  const newEase = Math.max(
    MIN_EASE,
    prev.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  );

  if (q < 3) {
    // Reset: show again shortly
    return {
      ease: newEase,
      reps: 0,
      streak: 0,
      lastSeenAt: now,
      nextReviewAt: addMinutes(now, 10),
    };
  }

  const reps = prev.reps + 1;
  let intervalDays: number;
  if (reps === 1) intervalDays = 1;
  else if (reps === 2) intervalDays = 6;
  else {
    const prevInterval = daysBetween(prev.lastSeenAt, prev.nextReviewAt) || 1;
    intervalDays = Math.max(1, Math.round(prevInterval * newEase));
  }

  return {
    ease: newEase,
    reps,
    streak: prev.streak + 1,
    lastSeenAt: now,
    nextReviewAt: addDays(now, intervalDays),
  };
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}
function addMinutes(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 60_000);
}
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export const QUALITY = { forgot: 1 as Quality, partial: 3 as Quality, known: 5 as Quality };
