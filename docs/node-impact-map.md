# Zhishu Node Impact Map

## Verified execution choke points

| Concern | Existing source of truth | Zhishu integration |
|---|---|---|
| Provider dispatch | `server/modules/providers/services/provider-runtime.service.ts` | `runtime.service.ts` calls `providerRuntimeService.run()` rather than importing a provider adapter. |
| Normalized event outlet | `ProviderRuntimeWriter.send()` in `server/shared/types.ts` | The Runtime writer maps provider-neutral messages to versioned `RuntimeEvent` values. |
| Cancellation | `providerRuntimeService.abort(provider, sessionId)` | Task runs use `runtimeRunId` as the provider lookup key and expose `/runs/{id}/cancel`. |
| Permission decision | `providerRuntimeService.resolveToolApproval()` | The internal Approval Decision endpoint resolves the same pending provider hook used by Chat. |
| Claude permission wait | `canUseTool()` and `waitForToolApproval()` in `claude-runtime.provider.js` | `permission_request` becomes `APPROVAL_REQUIRED`; a Java decision resumes the pending Promise. |
| Terminal result | Normalized `complete` and `error` messages | Exit code 0 maps to `RUN_COMPLETED`; non-zero maps to `RUN_FAILED`; cancellation maps to `RUN_ABORTED`. |

## Implemented in the first Runtime slice

- Runtime Protocol v1 bearer authentication.
- `POST /internal/runtime/v1/runs` with HTTP 202 semantics.
- Durable SQLite Start-command idempotency using key + semantic request hash + response snapshot.
- Versioned Prompt Assembly for one Claude executor.
- Provider-neutral capability names with an initial Claude tool mapping.
- Monotonic per-run event sequencing.
- Approval and cancellation forwarding through the existing provider gateway.
- Control Plane event callback with a local structured-log fallback.

## Known follow-up work

- Run a live Claude SDK test against the fixed demo repository.
- Persist Cancel and Approval Decision idempotency records.
- Add Artifact collection for Git Diff and test reports.
- Add a persistent event Outbox only after the Golden Core callback path is stable.
- Replace process-local run recovery with Heartbeat/Lease in the reliability phase.
