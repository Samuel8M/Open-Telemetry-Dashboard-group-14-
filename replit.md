# Model Telemetry

Guide beginners through three simple pages for local open-weight models, private adapter training, and transparent laptop benchmarks.

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
- Private model workshop CLI and guide: `artifacts/model-telemetry/public/private-model.py` and `private-model-readme.txt`
- Local standardized Ollama runner and setup guide: `artifacts/model-telemetry/public/benchmark.py` and `benchmark-readme.txt`
- Optional manual command collector: `artifacts/model-telemetry/public/collector.py`
- Telemetry API: `artifacts/api-server/src/routes/telemetry.ts`
- API contract: `lib/api-spec/openapi.yaml`

## Architecture decisions

- The workshop has one main step per page: download at `/`, understand weight metadata at `/interpret`, and train a local adapter on private text at `/adjust`. Benchmarks remain at `/benchmarks`. The website never pretends to install or train a model on the visitor's computer.
- The hosted site never reads or uploads the user's private training text. Model selection is stored locally in the browser; a training path is only used to compose a terminal command. A locally run Python CLI explicitly downloads public, full safetensors checkpoints and trains local LoRA adapters with offline libraries. Ollama GGUF inference downloads are a separate path and are not directly fine-tuned.
- The weight-report import shows local tensor metadata and adapter parameter counts, not interpretable facts inside individual numeric weights. Reports stay in browser memory, not on the server.
- Cloud coding agents expose only their local client footprint; the UI must never imply that provider-side GPU or CPU usage is measured.
- The dashboard defaults to an empty measurements view; the API's illustrative example is accessible only via an explicit switch. Local benchmark files are imported into browser storage, not uploaded to the API.
- The downloadable Python runner drives locally installed Ollama: model pulls require explicit opt-in, and model selection is bounded by laptop RAM and disk checks. It runs the same prompts on each model and measures Ollama-process CPU/RAM plus Ollama-reported generation speed.
- Workload check scores are narrow deterministic checks, not general model-quality ratings. GPU, time to first token, and cost are unavailable unless separately measured or supplied; never replace missing values with invented numbers.

## Product

A three-page guided local-model workspace: users choose a supported open-weight checkpoint and download it on their own laptop, import a small local metadata report to understand its weights, then train a LoRA adapter on their own private text. The separate benchmarks page compares imported Ollama runs without presenting examples as real measurements.

## User preferences

- Keep the workshop simple enough for a beginner: download weights → understand weights → adjust with private text. Each page gets exactly one main button; short help links may explain setup. Do not add extra action buttons or pretend a hosted site can train on the visitor's laptop.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
