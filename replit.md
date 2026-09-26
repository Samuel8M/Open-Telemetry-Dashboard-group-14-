# Model Telemetry

Guide beginners through a tiny, trainable browser model alongside transparent laptop benchmarks.

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

- The three workshop routes `/`, `/interpret`, and `/adjust` teach with a tiny English next-character model that runs entirely in the browser tab. It is not an open-weight LLM. Training text and adjusted weights stay in tab memory and reset on refresh. No download, login, terminal, API call, or upload is needed. Benchmarks remain at `/benchmarks`.
- The optional local training kit at `/local-models` offers seven pinned, curated public safetensors checkpoints and a standalone Python CLI for advanced laptop LoRA training. It is separate from the three-page browser workshop and does not run training on the site. Ollama GGUF inference downloads are a separate path and are not directly fine-tuned.
- Cloud coding agents expose only their local client footprint; the UI must never imply that provider-side GPU or CPU usage is measured.
- The dashboard defaults to an empty measurements view; the API's illustrative example is accessible only via an explicit switch. Local benchmark files are imported into browser storage, not uploaded to the API.
- The downloadable Python runner drives locally installed Ollama: model pulls require explicit opt-in, and model selection is bounded by laptop RAM and disk checks. It runs the same prompts on each model and measures Ollama-process CPU/RAM plus Ollama-reported generation speed.
- Workload check scores are narrow deterministic checks, not general model-quality ratings. GPU, time to first token, and cost are unavailable unless separately measured or supplied; never replace missing values with invented numbers.

## Product

A no-download browser workshop in three steps: start a tiny practice model, see a next-letter guess made from its weights, and teach it with pasted text. The separate benchmarks page compares imported Ollama runs without presenting examples as real measurements.

## User preferences

- Keep the browser workshop simple enough for a beginner. Each route has one obvious main button and brief optional help. No downloadable-app requirement. Never present the tiny browser exercise as full LLM fine-tuning or claim private text was uploaded.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
