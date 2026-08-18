# Claude Permission Hook Spike

## Result

The existing Claude adapter already implements the required asynchronous wait model:

1. `canUseTool` creates a provider request id.
2. It emits a normalized `permission_request` before waiting.
3. `waitForToolApproval` stores a resolver in `pendingToolApprovals`.
4. `providerRuntimeService.resolveToolApproval` resolves the pending Promise.
5. An abort signal cancels the wait and returns a deny result to Claude.

The Runtime module now maps this path to `APPROVAL_REQUIRED` and exposes a versioned
Approval Decision endpoint for the Control Plane.

## Timeout boundary

- Ordinary tool approval currently defaults to `CLAUDE_TOOL_APPROVAL_TIMEOUT_MS=55000`.
- `AskUserQuestion` and `ExitPlanMode` use an indefinite application wait (`timeoutMs=0`).
- Golden Core should configure the Java approval timeout below the Node/SDK timeout.
- Cancel must invalidate the Java approval before sending a late decision.

## Verification status

- Static code path: verified.
- Runtime service approval/resume behavior: covered by an isolated automated test.
- Live Claude SDK wait duration and UI round trip: still requires the fixed demo repository spike.
