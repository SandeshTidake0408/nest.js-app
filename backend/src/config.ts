/**
 * Operational settings live here. Environment variables override these defaults
 * so Docker/production can tune behaviour without changing worker code.
 */
const defaults = {
  apiPort: 3000,
  maxAttempts: 5,
  leaseDurationSeconds: 15,
  pollIntervalMs: 250,
  eventsListLimit: 250,
} as const;

function positiveNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const config = {
  ...defaults,
  apiPort: positiveNumber('PORT', defaults.apiPort),
  maxAttempts: Math.floor(positiveNumber('MAX_ATTEMPTS', defaults.maxAttempts)),
  leaseDurationSeconds: positiveNumber('LEASE_SECONDS', defaults.leaseDurationSeconds),
  pollIntervalMs: positiveNumber('POLL_INTERVAL_MS', defaults.pollIntervalMs),
  eventsListLimit: Math.floor(positiveNumber('EVENTS_LIST_LIMIT', defaults.eventsListLimit)),
} as const;

export type WorkerConfig = Pick<typeof config,
  'maxAttempts' | 'leaseDurationSeconds'>;
