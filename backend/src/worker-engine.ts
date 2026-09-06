import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { ClaimedEvent, WebhookData } from './types';
import { WorkerConfig } from './config';

export interface WorkerOptions extends WorkerConfig {
  workerId: string;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function simulation(data: WebhookData): {
  kind: 'ok' | 'fail' | 'slow';
  value: number;
} {
  const value = data.simulate;
  if (value === undefined || value === 'ok') return { kind: 'ok', value: 0 };
  if (value === 'always_fail')
    return { kind: 'fail', value: Number.MAX_SAFE_INTEGER };
  if (typeof value === 'string') {
    const retry = /^fail_then_succeed:(\d+)$/.exec(value);
    if (retry) return { kind: 'fail', value: Number(retry[1]) };
    const slow = /^slow:(\d+(?:\.\d+)?)$/.exec(value);
    if (slow) return { kind: 'slow', value: Number(slow[1]) };
  }
  // Malformed directives do not create an endlessly failing poison message.
  return { kind: 'ok', value: 0 };
}

/** PostgreSQL queue worker. All state transitions are conditional on a per-claim lease token. */
export class WorkerEngine {
  constructor(
    private readonly db: Pool,
    private readonly options: WorkerOptions,
  ) {}

  async processOne(): Promise<boolean> {
    const event = await this.claim();
    if (!event) return false;
    try {
      const rule = simulation(event.data);
      if (rule.kind === 'slow') await delay(rule.value * 1_000);
      if (rule.kind === 'fail' && event.attempt_count <= rule.value) {
        throw new Error(
          `Simulated temporary failure on attempt ${event.attempt_count}`,
        );
      }
      await this.succeed(event);
    } catch (error) {
      await this.fail(
        event,
        error instanceof Error ? error.message : String(error),
      );
    }
    return true;
  }

  private async claim(): Promise<ClaimedEvent | undefined> {
    const client = await this.db.connect();
    const token = randomUUID();
    try {
      await client.query('BEGIN');
      // A dead worker leaves an unfinished history entry. Close it before starting recovery.
      await client.query(`UPDATE processing_attempts pa SET result = 'abandoned', finished_at = NOW(),
          error = COALESCE(error, 'Lease expired before the worker finished')
        FROM webhook_events e
        WHERE pa.event_id = e.event_id AND pa.result = 'processing'
          AND e.status = 'processing' AND e.lease_until < NOW()`);
      const claimed = await client.query<ClaimedEvent>(
        `WITH candidate AS (
          SELECT event_id FROM webhook_events
          WHERE (status = 'pending' AND available_at <= NOW())
             OR (status = 'processing' AND lease_until < NOW())
          ORDER BY available_at, created_at
          LIMIT 1 FOR UPDATE SKIP LOCKED
        ), updated AS (
          UPDATE webhook_events e SET status = 'processing', attempt_count = e.attempt_count + 1,
            lifetime_attempt_count = e.lifetime_attempt_count + 1,
            lease_until = NOW() + ($1::text || ' seconds')::interval, lease_token = $2::uuid,
            updated_at = NOW()
          FROM candidate c WHERE e.event_id = c.event_id
          RETURNING e.event_id, e.type, e.data, e.attempt_count,
            e.lifetime_attempt_count AS attempt_number, e.lease_token
        ) SELECT * FROM updated`,
        [this.options.leaseDurationSeconds, token],
      );
      const event = claimed.rows[0];
      if (event) {
        await client.query(
          `INSERT INTO processing_attempts (event_id, attempt_number, worker_id)
          VALUES ($1, $2, $3)`,
          [event.event_id, event.attempt_number, this.options.workerId],
        );
      }
      await client.query('COMMIT');
      return event;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async succeed(event: ClaimedEvent) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const owned = await client.query(
        `SELECT event_id FROM webhook_events
        WHERE event_id = $1 AND status = 'processing' AND lease_token = $2::uuid FOR UPDATE`,
        [event.event_id, event.lease_token],
      );
      if (owned.rowCount !== 1) {
        await client.query('ROLLBACK');
        return;
      }
      const orderId =
        typeof event.data.orderId === 'string'
          ? event.data.orderId
          : event.event_id;
      // This unique key is the final duplicate-protection boundary if a lease is ever reclaimed.
      await client.query(
        `INSERT INTO processed_orders (event_id, order_id) VALUES ($1, $2)
        ON CONFLICT (event_id) DO NOTHING`,
        [event.event_id, orderId],
      );
      await client.query(
        `UPDATE webhook_events SET status = 'succeeded', lease_until = NULL,
        lease_token = NULL, last_error = NULL, updated_at = NOW() WHERE event_id = $1`,
        [event.event_id],
      );
      await client.query(
        `UPDATE processing_attempts SET result = 'succeeded', finished_at = NOW()
        WHERE event_id = $1 AND attempt_number = $2 AND result = 'processing'`,
        [event.event_id, event.attempt_number],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async fail(event: ClaimedEvent, error: string) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const owned = await client.query(
        `SELECT attempt_count FROM webhook_events
        WHERE event_id = $1 AND status = 'processing' AND lease_token = $2::uuid FOR UPDATE`,
        [event.event_id, event.lease_token],
      );
      if (owned.rowCount !== 1) {
        await client.query('ROLLBACK');
        return;
      }
      const permanent = event.attempt_count >= this.options.maxAttempts;
      await client.query(
        `UPDATE webhook_events SET status = $1, available_at = NOW(),
        lease_until = NULL, lease_token = NULL, last_error = $2, updated_at = NOW() WHERE event_id = $3`,
        [permanent ? 'failed' : 'pending', error, event.event_id],
      );
      await client.query(
        `UPDATE processing_attempts SET result = $1, error = $2, finished_at = NOW()
        WHERE event_id = $3 AND attempt_number = $4 AND result = 'processing'`,
        [
          permanent ? 'failed' : 'retry',
          error,
          event.event_id,
          event.attempt_number,
        ],
      );
      await client.query('COMMIT');
    } catch (failure) {
      await client.query('ROLLBACK');
      throw failure;
    } finally {
      client.release();
    }
  }
}
