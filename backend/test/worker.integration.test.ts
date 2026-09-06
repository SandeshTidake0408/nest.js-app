import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { WorkerEngine } from '../src/worker-engine';

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? test : test.skip;

function eventId(name: string) {
  return `test-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function worker(db: Pool, id: string) {
  return new WorkerEngine(db, {
    workerId: id,
    maxAttempts: 3,
    leaseDurationSeconds: 1,
  });
}

integration(
  'two workers claim/process a duplicate event only once',
  async () => {
    const db = new Pool({ connectionString });
    const id = eventId('duplicate');
    try {
      await db.query(
        `INSERT INTO webhook_events (event_id, type, data) VALUES ($1, 'order.created', '{"orderId":"O-1"}')`,
        [id],
      );
      await Promise.all([
        worker(db, 'test-a').processOne(),
        worker(db, 'test-b').processOne(),
      ]);
      const work = await db.query(
        'SELECT * FROM processed_orders WHERE event_id = $1',
        [id],
      );
      const state = await db.query(
        'SELECT status, attempt_count FROM webhook_events WHERE event_id = $1',
        [id],
      );
      assert.equal(work.rowCount, 1);
      assert.equal(state.rows[0].status, 'succeeded');
      assert.equal(state.rows[0].attempt_count, 1);
    } finally {
      await db.query('DELETE FROM webhook_events WHERE event_id = $1', [id]);
      await db.end();
    }
  },
);

integration(
  'temporary failures retry and retain a complete attempt history',
  async () => {
    const db = new Pool({ connectionString });
    const id = eventId('retry');
    const engine = worker(db, 'test-retry');
    try {
      await db.query(
        `INSERT INTO webhook_events (event_id, type, data) VALUES ($1, 'order.created', '{"orderId":"O-2","simulate":"fail_then_succeed:2"}')`,
        [id],
      );
      for (let attempt = 0; attempt < 3; attempt++) await engine.processOne();
      const state = await db.query(
        'SELECT status, attempt_count FROM webhook_events WHERE event_id = $1',
        [id],
      );
      const history = await db.query(
        'SELECT result FROM processing_attempts WHERE event_id = $1 ORDER BY attempt_number',
        [id],
      );
      assert.equal(state.rows[0].status, 'succeeded');
      assert.equal(state.rows[0].attempt_count, 3);
      assert.deepEqual(
        history.rows.map((row) => row.result),
        ['retry', 'retry', 'succeeded'],
      );
    } finally {
      await db.query('DELETE FROM webhook_events WHERE event_id = $1', [id]);
      await db.end();
    }
  },
);
