import { Router, type IRouter } from "express";
import {
  GetTelemetryDashboardQueryParams,
  GetTelemetryDashboardResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const scenarios = [
  { id: "code-fix" as const, label: "Repository bug fix" },
  { id: "summarization" as const, label: "Document summary" },
  { id: "data-extraction" as const, label: "Structured data extraction" },
];

const models = [
  {
    model: "Qwen 2.5 Coder 14B",
    provider: "Ollama",
    runtime: "local" as const,
    runs: 12,
    qualityScore: 86,
    timeToFirstTokenMs: 510,
    tokensPerSecond: 31.8,
    peakMemoryGb: 11.6,
    averageCpuPercent: 42,
    averageGpuPercent: 78,
    estimatedCostUsd: 0,
  },
  {
    model: "Llama 3.1 8B",
    provider: "LM Studio",
    runtime: "local" as const,
    runs: 12,
    qualityScore: 78,
    timeToFirstTokenMs: 290,
    tokensPerSecond: 49.2,
    peakMemoryGb: 7.4,
    averageCpuPercent: 35,
    averageGpuPercent: 62,
    estimatedCostUsd: 0,
  },
  {
    model: "Claude Code",
    provider: "Anthropic",
    runtime: "cloud-client" as const,
    runs: 10,
    qualityScore: 93,
    timeToFirstTokenMs: 940,
    tokensPerSecond: 24.6,
    peakMemoryGb: 0.46,
    averageCpuPercent: 8,
    averageGpuPercent: null,
    estimatedCostUsd: 0.21,
  },
  {
    model: "Codex CLI",
    provider: "OpenAI",
    runtime: "cloud-client" as const,
    runs: 10,
    qualityScore: 90,
    timeToFirstTokenMs: 810,
    tokensPerSecond: 27.1,
    peakMemoryGb: 0.52,
    averageCpuPercent: 9,
    averageGpuPercent: null,
    estimatedCostUsd: 0.18,
  },
];

router.get("/telemetry/dashboard", async (req, res): Promise<void> => {
  const parsed = GetTelemetryDashboardQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const now = Date.now();
  const scenarioFilter = parsed.data.scenario ?? "all";
  const windowDays = { "7d": 7, "30d": 30, "90d": 90 }[
    parsed.data.window ?? "30d"
  ];
  const allRuns = models.flatMap((model, modelIndex) =>
    scenarios.map((scenario, scenarioIndex) => ({
      id: `sample-${modelIndex + 1}-${scenarioIndex + 1}`,
      timestamp: new Date(now - (
        scenarioIndex === modelIndex % 3
          ? modelIndex + 1
          : 10 + modelIndex * 6 + scenarioIndex * 12
      ) * 86_400_000).toISOString(),
      scenarioId: scenario.id,
      scenarioLabel: scenario.label,
      model: model.model,
      provider: model.provider,
      runtime: model.runtime,
      durationSeconds: Number(
        (18 + modelIndex * 4.7 + scenarioIndex * 3.1).toFixed(1),
      ),
      qualityScore: Math.max(
        0,
        model.qualityScore - scenarioIndex * 2 + (scenarioIndex === 1 ? 3 : 0),
      ),
      tokensPerSecond: model.tokensPerSecond,
      peakMemoryGb: model.peakMemoryGb,
      averageCpuPercent: model.averageCpuPercent,
      averageGpuPercent: model.averageGpuPercent,
      estimatedCostUsd: model.estimatedCostUsd,
    })),
  );
  const recentRuns = allRuns
    .filter((run) => scenarioFilter === "all" || run.scenarioId === scenarioFilter)
    .filter((run) => Date.parse(run.timestamp) >= now - windowDays * 86_400_000)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const modelComparisons = models.flatMap((model) => {
    const runs = recentRuns.filter((run) => run.model === model.model);
    if (!runs.length) return [];
    return [{
      ...model,
      runs: runs.length,
      qualityScore: Number(
        (runs.reduce((sum, run) => sum + run.qualityScore, 0) / runs.length).toFixed(1),
      ),
    }];
  });

  const resourceTrend = Array.from({ length: 24 }, (_, index) => ({
    timestamp: new Date(now - (23 - index) * 60_000).toISOString(),
    cpuPercent: 18 + ((index * 17) % 53),
    memoryGb: Number((5.8 + ((index * 7) % 29) / 10).toFixed(1)),
    gpuPercent: 22 + ((index * 23) % 67),
  }));

  const dashboard = {
    dataMode: "illustrative-sample" as const,
    generatedAt: new Date(now).toISOString(),
    attribution:
      "Illustrative benchmark data, not measurements from your laptop. Cloud entries show the local client footprint only; provider-side CPU, memory, and GPU usage is not exposed.",
    device: {
      machineLabel: "Example developer laptop",
      operatingSystem: "macOS 15",
      cpu: "Apple M3 Pro",
      gpu: "18-core integrated GPU",
      memoryGb: 18,
    },
    collector: {
      state: "disconnected" as const,
      message:
        "Install and connect the local collector to replace sample data with measurements from this machine.",
      lastSeen: null,
    },
    summary: {
      runs: recentRuns.length,
      models: modelComparisons.length,
      averageQuality: recentRuns.length
        ? Number((recentRuns.reduce((sum, run) => sum + run.qualityScore, 0) / recentRuns.length).toFixed(1))
        : null,
      medianTokensPerSecond: recentRuns.length
        ? (() => {
          const sorted = recentRuns.map((run) => run.tokensPerSecond).sort((a, b) => a - b);
          const middle = Math.floor(sorted.length / 2);
          return Number((sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2).toFixed(1));
        })()
        : null,
      peakMemoryGb: recentRuns.length ? Math.max(...recentRuns.map((run) => run.peakMemoryGb)) : 0,
      localGpuObserved: recentRuns.some((run) => run.averageGpuPercent !== null),
    },
    scenarios,
    resourceTrend,
    modelComparisons,
    recentRuns,
  };

  res.json(GetTelemetryDashboardResponse.parse(dashboard));
});

export default router;