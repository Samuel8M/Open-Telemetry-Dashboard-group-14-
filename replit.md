# Model Telemetry

Compare AI model and coding-agent quality, speed, cost, and local laptop resource usage using transparent benchmark telemetry.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- Dashboard UI: `artifacts/model-telemetry`
- Local standardized Ollama runner and setup guide: `artifacts/model-telemetry/public/benchmark.py` and `benchmark-readme.txt`
- Optional manual command collector: `artifacts/model-telemetry/public/collector.py`
- Telemetry API: `artifacts/api-server/src/routes/telemetry.ts`
- API contract: `lib/api-spec/openapi.yaml`

## Architecture decisions

- Cloud coding agents expose only their local client footprint; the UI must never imply that provider-side GPU or CPU usage is measured.
- The dashboard defaults to an empty measurements view; the API's illustrative example is accessible only via an explicit switch. Local benchmark files are imported into browser storage, not uploaded to the API.
- The downloadable Python runner drives locally installed Ollama: model pulls require explicit opt-in, and model selection is bounded by laptop RAM and disk checks. It runs the same prompts on each model and measures Ollama-process CPU/RAM plus Ollama-reported generation speed.
- Workload check scores are narrow deterministic checks, not general model-quality ratings. GPU, time to first token, and cost are unavailable unless separately measured or supplied; never replace missing values with invented numbers.

## Product

A local open-model benchmarking workflow: users download a Python runner, choose quantized Ollama models and authorize any downloads, run standardized workloads on macOS or Windows laptops, then import JSON results to compare token speed, fixed workload checks, and process CPU/RAM use.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
