import { Injectable, NotFoundException } from '@nestjs/common';
import { pool } from './database';
import { CreateWebhookDto } from './webhooks.dto';
import { config } from './config';

@Injectable()
export class WebhooksService {
  async receive(event: CreateWebhookDto) {
    const result = await pool.query(
      `INSERT INTO webhook_events (event_id, type, data)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [event.eventId, event.type, JSON.stringify(event.data)],
    );
    return {
      eventId: event.eventId,
      accepted: true,
      duplicate: result.rowCount === 0,
    };
  }

  async list() {
    const events = await pool.query(
      `SELECT event_id AS "eventId", type, data, status,
      attempt_count AS "attemptCount", available_at AS "availableAt", lease_until AS "leaseUntil",
      last_error AS "lastError", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM webhook_events ORDER BY created_at DESC LIMIT $1`,
      [config.eventsListLimit],
    );
    const attempts =
      await pool.query(`SELECT event_id AS "eventId", attempt_number AS "attemptNumber",
      worker_id AS "workerId", started_at AS "startedAt", finished_at AS "finishedAt", result, error
      FROM processing_attempts ORDER BY event_id, attempt_number`);
    const byEvent = new Map<string, unknown[]>();
    for (const attempt of attempts.rows) {
      const history = byEvent.get(attempt.eventId) ?? [];
      history.push(attempt);
      byEvent.set(attempt.eventId, history);
    }
    return events.rows.map((event) => ({
      ...event,
      attempts: byEvent.get(event.eventId) ?? [],
    }));
  }

  async retry(eventId: string) {
    const result = await pool.query(
      `UPDATE webhook_events
      SET status = 'pending', attempt_count = 0, available_at = NOW(), lease_until = NULL,
          lease_token = NULL, last_error = NULL, updated_at = NOW()
      WHERE event_id = $1 AND status = 'failed'
      RETURNING event_id AS "eventId", status`,
      [eventId],
    );
    if (!result.rowCount) throw new NotFoundException('Failed event not found');
    return result.rows[0];
  }
}
