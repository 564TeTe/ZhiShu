# Runtime Protocol v1

The source contract is [`contracts/runtime-v1/openapi.yaml`](../contracts/runtime-v1/openapi.yaml).
Runtime callback events are described by
[`contracts/runtime-v1/runtime-events.schema.json`](../contracts/runtime-v1/runtime-events.schema.json).

## Transport rules

- JSON over HTTP/1.1.
- `Authorization: Bearer ${ZS_RUNTIME_TOKEN}` on both directions.
- `protocolVersion` is exactly `1.0`.
- Start returns `202 Accepted`; it does not mean the Agent has started.
- Start returns `503 RUNTIME_EVENT_DELIVERY_NOT_READY` before provider dispatch when
  `ZHISHU_CONTROL_BASE_URL` or `ZS_RUNTIME_TOKEN` is missing, or when the callback URL
  is not HTTP(S).
- `RUN_STARTED` is the only signal that moves a Java Attempt from STARTING to RUNNING.
- Authenticated `GET /internal/runtime/v1/health` exposes secret-free delivery and
  outbox statistics. The public Node `/health` response embeds the same snapshot while
  keeping the ordinary Chat process status independent from Spring availability.

## Start idempotency

Node stores `idempotencyKey`, command type, semantic request hash, and the accepted
response in SQLite before dispatching the provider run.

- Same key and same semantic hash: replay the first `runtimeRunId`.
- Same key and different semantic hash: `409 IDEMPOTENCY_CONFLICT`.
- `requestId` is excluded from the semantic hash so an HTTP retry may use a new request id.

## Control command idempotency

Cancel and Approval Decision also require `protocolVersion`, `requestId`, and a stable
`idempotencyKey`. Node inspects its SQLite record before checking live run state, so an
exact retry can replay the first response after the run has become terminal or the
approval has already been removed. Reusing a key for another run, approval, decision,
or message returns `409 IDEMPOTENCY_CONFLICT`.

Golden Core records the command claim before invoking the provider side effect. Full
crash recovery between the claim and side effect remains a Reliability Bonus.

## Event ordering

Every run owns a monotonic `sequenceNo` starting at 1. Node writes every event to the
SQLite `runtime_event_outbox` before returning to the Runtime service. The delivery
worker only selects the lowest pending sequence for each run, so a failed event blocks
later events from overtaking it.

The worker deletes an outbox row only after a successful Spring response. Transport,
configuration, and non-2xx failures use jittered exponential backoff from about one
second up to one minute. Node startup scans the same table and resumes pending events
left by an earlier process. A network timeout may cause the same event to arrive more
than once, so the Spring receiver still enforces both `event_id UNIQUE` and
`UNIQUE(attempt_id, sequence_no)` before updating its state machine.
