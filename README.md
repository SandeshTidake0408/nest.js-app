# Reliable webhook processor

Run everything from a clean clone:

```sh
docker compose up --build
```

The API is at `http://localhost:3000`, and the operations page is at `http://localhost:3001`. The stack starts PostgreSQL, the NestJS API, a Next.js operations page, and two independently configured worker processes. No manual database setup is needed.

The images use Node.js 24.20.0 LTS and PostgreSQL 18.6; the frontend uses Next.js 16's App Router. Runtime defaults are centralized in [backend/src/config.ts](backend/src/config.ts), with Docker environment overrides for `MAX_ATTEMPTS`, `LEASE_SECONDS`, `POLL_INTERVAL_MS`, and `EVENTS_LIST_LIMIT`. Browser refresh settings are in [frontend/app/config.ts](frontend/app/config.ts). TypeScript is pinned to 6.0.3 because Nest CLI does not yet support TypeScript 7's changed compiler API.

## Architecture

`POST /webhooks` inserts into `webhook_events` before returning `202`. The event ID is the primary key, so repeated (including concurrent) deliveries turn into no-op inserts. Workers poll PostgreSQL directly. They claim a row in a short transaction using `FOR UPDATE SKIP LOCKED`, assign it a random lease token, and record a `processing_attempts` row.

If a worker exits, its lease expires; another worker closes the unfinished history row as `abandoned`, reclaims the event, and starts another attempt. Success writes `processed_orders` and marks the event succeeded in the same transaction. `processed_orders.event_id` is unique, which is the final idempotency boundary.

Failures return directly to `pending` until `MAX_ATTEMPTS` (default 5), so a worker picks them up automatically on its next poll. Once the cap is reached, an event is permanently failed. The UI's Retry button resets that retry budget while retaining the immutable lifetime attempt numbering/history.

## Quick demonstrations

```sh
# Duplicate delivery — run this command several times, or in parallel.
curl -X POST localhost:3000/webhooks -H 'content-type: application/json' \
  -d '{"eventId":"evt-duplicate","type":"order.created","data":{"orderId":"ORD-1"}}'

# Fails twice, then succeeds; inspect it at localhost:3001.
curl -X POST localhost:3000/webhooks -H 'content-type: application/json' \
  -d '{"eventId":"evt-retry","type":"order.created","data":{"orderId":"ORD-2","simulate":"fail_then_succeed:2"}}'

# Permanent failure, then use Retry in the UI.
curl -X POST localhost:3000/webhooks -H 'content-type: application/json' \
  -d '{"eventId":"evt-failed","type":"order.created","data":{"orderId":"ORD-3","simulate":"always_fail"}}'

# Parallel work: submit several IDs with slow:10. worker-1 and worker-2 will each handle one.
for n in 1 2 3 4; do curl -s -X POST localhost:3000/webhooks -H 'content-type: application/json' \
  -d "{\"eventId\":\"evt-slow-$n\",\"type\":\"order.created\",\"data\":{\"orderId\":\"ORD-$n\",\"simulate\":\"slow:10\"}}"; done

# Crash recovery: submit slow:30, then stop its active worker:
docker compose kill worker-1
# The other worker reclaims it after the 15-second lease. Restart the killed worker if desired:
docker compose up -d worker-1

# Burst of 500 events (uses xargs concurrency):
seq 1 500 | xargs -P 30 -I{} curl -s -X POST localhost:3000/webhooks -H 'content-type: application/json' \
  -d '{"eventId":"evt-burst-{}","type":"order.created","data":{"orderId":"ORD-{}"}}' > /dev/null
```

Check the durable work record directly:

```sh
docker compose exec db psql -U webhook -d webhooks -c 'select * from processed_orders order by processed_at desc;'
```

## Tests

The integration tests use the configured PostgreSQL database and cover concurrent claiming/idempotent work and retry history:

```sh
docker compose exec -e DATABASE_URL=postgres://webhook:webhook@db:5432/webhooks api npm run test --workspace backend
```

## Correctness and trade-offs

- A duplicated API delivery has one event row; one claim can hold a row at once; and the business record has a unique `event_id`, so it can never contain two rows for one webhook.
- A worker crash leaves an expiring, tokenized lease. Lease checks prevent a stale worker from finalising a reclaimed job.
- A slow task that exceeds `LEASE_SECONDS` can be reclaimed while its original worker is still running. `processed_orders.event_id` still prevents a second database work record, but a real non-idempotent external side effect would need an outbox/idempotency key.
- The operations endpoint returns the most recent 250 events; pagination and authentication are intentionally absent. PostgreSQL is also both system of record and queue, so a much larger sustained throughput workload would benefit from queue-specific tuning or a broker.

## Hardest bug

Resetting `attempt_count` for manual retry initially reused `(event_id, attempt_number)` and conflicted with prior history. The fix was to retain a separate `lifetime_attempt_count` for immutable attempt-history numbers while `attempt_count` remains the retry-budget counter for the current manual-retry cycle.

## Next priorities

1. Add authenticated admin operations and paginated/filterable event views.
2. Add metrics/alerts for expired leases and permanently failed events.
3. Use an outbox and downstream idempotency keys for real external effects.
