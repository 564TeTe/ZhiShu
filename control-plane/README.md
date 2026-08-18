# Zhishu Control Plane

Spring Boot control plane for durable AgentTask and TaskAttempt orchestration.

## Prerequisites

- JDK 21
- Maven 3.9+
- PostgreSQL 16, normally started with Docker Compose
- Node Runtime listening on `http://127.0.0.1:3001`

On this Windows workspace Maven inherits an unrelated Java 8 `JAVA_HOME`. Use:

```powershell
$env:JAVA_HOME='C:\Program Files\Java\jdk-21'
$env:Path="$env:JAVA_HOME\bin;$env:Path"
```

## Start PostgreSQL

```powershell
docker compose -f compose.yml up -d
```

## Configure the Runtime link

Use the same secret in the Node and Spring processes:

```powershell
$env:ZS_RUNTIME_TOKEN='replace-with-a-long-random-secret'
$env:ZHISHU_RUNTIME_BASE_URL='http://127.0.0.1:3001'
```

Node should also know where to report Runtime events:

```powershell
$env:ZHISHU_CONTROL_BASE_URL='http://127.0.0.1:8080'
```

Browser API requests are accepted from the integrated UI on port `3001` and
the Vite development UI on port `5173` by default, for both `localhost` and
`127.0.0.1`. Set `ZHISHU_UI_ALLOWED_ORIGINS` to replace this origin allowlist
when deploying the UI elsewhere.

## Verify

```powershell
mvn test
mvn package
```

## Bootstrap a local project and profile

After Flyway has created the schema, load the development records (edit the workspace path first if needed):

```powershell
Get-Content examples/bootstrap-local.sql | docker compose exec -T postgres psql -U zhishu -d zhishu
```

Then create a task:

```powershell
$body = @{
  projectId = '11111111-1111-1111-1111-111111111111'
  profileId = '22222222-2222-2222-2222-222222222222'
  title = '验证知枢任务链路'
  objective = '阅读项目结构并运行最小测试，不修改文件。'
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8080/api/v1/tasks `
  -ContentType application/json -Body $body
```

Subscribe to durable events with `GET /api/v1/tasks/{taskId}/events`. Send the last received database event id in the `Last-Event-ID` header after reconnecting.

The current slice contains:

- PostgreSQL/Flyway Golden Core schema.
- TaskAttempt state machine.
- immutable AgentProfile snapshot validation.
- TaskOrchestrator with PENDING persistence before the Node network boundary.
- Runtime Protocol v1 RestClient.
- CAS-style Attempt status persistence.
- REST task creation and current-state queries.
- bearer-authenticated, idempotent Runtime event ingestion.
- deferred event projection for the HTTP-acceptance race.
- approval request projection and Task/Attempt state synchronization.
- commit-aware SSE publishing with `Last-Event-ID` replay.

The current project also includes Artifact persistence and presentation,
Testcontainers PostgreSQL integration coverage, Runtime Event Outbox recovery,
and a repeatable four-step real-Agent demo workflow. Run it from the repository
root with `npm run demo:check`, `npm run demo:start`, `npm run demo:verify`, and
`npm run demo:stop`; see `docs/demo-runbook.md` for the evidence and safety model.
