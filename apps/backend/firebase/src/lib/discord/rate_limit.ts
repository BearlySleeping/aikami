// apps/backend/firebase/src/lib/discord/rate_limit.ts
//
// Persistent per-user rate limit for /bug and /feature submissions, backed
// by Firestore — the only shared storage available across Cloud Functions
// instances. Process-local state would reset per instance and per cold
// start, so it cannot enforce a cross-instance quota; Firestore can.
//
// Strategy: a fixed per-user window (WINDOW_MS) with a submission cap. One
// document per Discord user id; the window starts at the first submission
// and resets once WINDOW_MS elapses. A transaction makes the check-and-
// increment atomic, so concurrent submissions from the same user cannot
// both slip past the cap.

// Subpath import, not the bare '@aikami/backend/configs': this app's
// tsconfig only maps '@aikami/backend/configs/*' (see tsconfig.json paths).
import { getFirestore, serverTimestamp } from '@aikami/backend/configs/firestore';

const SUBMISSION_COLLECTION = 'discord_issue_submissions';

/** Length of the per-user counting window (24h). */
const WINDOW_MS = 24 * 60 * 60 * 1000;

/** Max issue submissions per user per window. */
const MAX_SUBMISSIONS_PER_WINDOW = 3;

/**
 * Attempt to reserve a submission slot for `userId`. Returns true when the
 * user is within their window cap (and the reservation is recorded), false
 * when the window cap is already exhausted. Atomic across concurrent calls.
 */
export const tryReserveIssueSubmission = async (userId: string): Promise<boolean> => {
  const db = getFirestore();
  const ref = db.collection(SUBMISSION_COLLECTION).doc(userId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    const windowStart = typeof data?.windowStartMs === 'number' ? data.windowStartMs : undefined;
    const inWindow = windowStart !== undefined && Date.now() - windowStart < WINDOW_MS;
    const count = inWindow && typeof data?.count === 'number' ? data.count : 0;
    if (count >= MAX_SUBMISSIONS_PER_WINDOW) {
      return false;
    }
    tx.set(
      ref,
      {
        count: count + 1,
        // Keep the original window start while the window is active — only a
        // fresh (or expired) window starts now.
        windowStartMs: inWindow ? windowStart : Date.now(),
        lastSubmittedAt: serverTimestamp(),
      },
      { merge: true },
    );
    return true;
  });
};
