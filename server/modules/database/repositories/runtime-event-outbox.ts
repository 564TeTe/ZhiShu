import { isDeepStrictEqual } from 'node:util';

import { getConnection } from '@/modules/database/connection.js';
import type {
  RuntimeEvent,
  RuntimeEventOutboxEntry,
  RuntimeEventOutboxStats,
} from '@/shared/types.js';

type RuntimeEventOutboxRow = {
  event_json: string;
  attempts: number;
  next_attempt_at: number;
  last_error: string | null;
  created_at: number;
};

function toEntry(row: RuntimeEventOutboxRow): RuntimeEventOutboxEntry {
  return {
    event: JSON.parse(row.event_json) as RuntimeEvent,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

function findConflict(event: RuntimeEvent): RuntimeEvent | null {
  const row = getConnection().prepare(`
    SELECT event_json
    FROM runtime_event_outbox
    WHERE event_id = ?
       OR (runtime_run_id = ? AND sequence_no = ?)
    ORDER BY CASE WHEN event_id = ? THEN 0 ELSE 1 END
    LIMIT 1
  `).get(event.eventId, event.runtimeRunId, event.sequenceNo, event.eventId) as {
    event_json: string;
  } | undefined;
  return row ? JSON.parse(row.event_json) as RuntimeEvent : null;
}

/**
 * Persistent Runtime event outbox repository consumed by the Runtime reporter.
 *
 * Enqueue is transactional and idempotent. Selection only exposes the lowest
 * undelivered sequence for each Runtime run, preventing a later lifecycle event
 * from overtaking an earlier event while that earlier event is backing off.
 */
export const runtimeEventOutboxDb = {
  enqueue(events: RuntimeEvent[], now: number): { inserted: number; duplicates: number } {
    const db = getConnection();
    const insert = db.prepare(`
      INSERT INTO runtime_event_outbox (
        event_id, task_id, attempt_id, runtime_run_id, sequence_no,
        event_json, next_attempt_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `);
    let inserted = 0;
    let duplicates = 0;

    db.transaction(() => {
      for (const event of events) {
        const result = insert.run(
          event.eventId,
          event.taskId,
          event.attemptId,
          event.runtimeRunId,
          event.sequenceNo,
          JSON.stringify(event),
          now,
          now,
        );
        if (result.changes === 1) {
          inserted += 1;
          continue;
        }

        const existing = findConflict(event);
        // Compare the JSON transport representation. Undefined object fields
        // are intentionally absent on the wire and must not create a false
        // conflict when an event is replayed from application memory.
        const incomingTransportEvent = JSON.parse(JSON.stringify(event)) as RuntimeEvent;
        if (!existing || !isDeepStrictEqual(existing, incomingTransportEvent)) {
          throw new Error(
            `Runtime outbox event id or run sequence was reused with different content: ${event.eventId}`,
          );
        }
        duplicates += 1;
      }
    })();

    return { inserted, duplicates };
  },

  findNextReady(now: number): RuntimeEventOutboxEntry | null {
    const row = getConnection().prepare(`
      SELECT event_json, attempts, next_attempt_at, last_error, created_at
      FROM runtime_event_outbox candidate
      WHERE candidate.next_attempt_at <= ?
        AND NOT EXISTS (
          SELECT 1
          FROM runtime_event_outbox earlier
          WHERE earlier.runtime_run_id = candidate.runtime_run_id
            AND earlier.sequence_no < candidate.sequence_no
        )
      ORDER BY candidate.created_at, candidate.runtime_run_id, candidate.sequence_no
      LIMIT 1
    `).get(now) as RuntimeEventOutboxRow | undefined;
    return row ? toEntry(row) : null;
  },

  findNextAvailableAt(): number | null {
    const row = getConnection().prepare(`
      SELECT MIN(candidate.next_attempt_at) AS next_attempt_at
      FROM runtime_event_outbox candidate
      WHERE NOT EXISTS (
        SELECT 1
        FROM runtime_event_outbox earlier
        WHERE earlier.runtime_run_id = candidate.runtime_run_id
          AND earlier.sequence_no < candidate.sequence_no
      )
    `).get() as { next_attempt_at: number | null };
    return row.next_attempt_at;
  },

  markFailed(eventId: string, nextAttemptAt: number, error: string): void {
    getConnection().prepare(`
      UPDATE runtime_event_outbox
      SET attempts = attempts + 1,
          next_attempt_at = ?,
          last_error = ?
      WHERE event_id = ?
    `).run(nextAttemptAt, error.slice(0, 2000), eventId);
  },

  markDelivered(eventId: string): void {
    getConnection().prepare(`
      DELETE FROM runtime_event_outbox
      WHERE event_id = ?
    `).run(eventId);
  },

  countPending(): number {
    const row = getConnection().prepare(`
      SELECT count(*) AS count
      FROM runtime_event_outbox
    `).get() as { count: number };
    return row.count;
  },

  getStats(now: number): RuntimeEventOutboxStats {
    const row = getConnection().prepare(`
      SELECT count(*) AS pending_count,
             COALESCE(sum(CASE WHEN next_attempt_at <= ? THEN 1 ELSE 0 END), 0) AS due_count,
             min(created_at) AS oldest_created_at,
             COALESCE(max(attempts), 0) AS max_attempts,
             (
               SELECT last_error
               FROM runtime_event_outbox failed
               WHERE failed.last_error IS NOT NULL
               ORDER BY failed.attempts DESC, failed.next_attempt_at DESC
               LIMIT 1
             ) AS last_error
      FROM runtime_event_outbox
    `).get(now) as {
      pending_count: number;
      due_count: number;
      oldest_created_at: number | null;
      max_attempts: number;
      last_error: string | null;
    };
    return {
      pendingCount: row.pending_count,
      dueCount: row.due_count,
      oldestCreatedAt: row.oldest_created_at,
      maxAttempts: row.max_attempts,
      lastError: row.last_error,
    };
  },
};
