import { pool } from './database';
import { WorkerEngine } from './worker-engine';
import { config } from './config';

const worker = new WorkerEngine(pool, {
  workerId: process.env.WORKER_ID ?? `worker-${process.pid}`,
  ...config,
});
let stopping = false;

async function loop() {
  while (!stopping) {
    try {
      if (!(await worker.processOne()))
        await new Promise((resolve) =>
          setTimeout(resolve, config.pollIntervalMs),
        );
    } catch (error) {
      console.error('Worker loop error', error);
      await new Promise((resolve) =>
        setTimeout(resolve, config.pollIntervalMs),
      );
    }
  }
  await pool.end();
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    stopping = true;
  });
loop().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
