import type { BenchmarkRun, ModelComparison, ResourcePoint, TelemetryDashboard } from '@workspace/api-client-react';
import { z } from 'zod';

const STORAGE_KEY = 'model-telemetry-imported-runs-v1';
const finite = z.number().finite();
const nonnegative = finite.min(0);
const percentage = finite.min(0).max(100);
const timestamp = z.string().refine(value => Number.isFinite(Date.parse(value)), 'Invalid timestamp');

const localRunSchema = z.object({
  format: z.literal('model-telemetry-run'),
  version: z.literal(1),
  id: z.string().min(1).max(120),
  timestamp,
  scenarioId: z.enum(['code-fix', 'summarization', 'data-extraction']),
  scenarioLabel: z.string().min(1).max(120),
  model: z.string().min(1).max(120),
  provider: z.string().min(1).max(120),
  runtime: z.enum(['local', 'cloud-client']),
  durationSeconds: nonnegative,
  qualityScore: percentage.nullable(),
  timeToFirstTokenMs: nonnegative.nullable(),
  tokensPerSecond: nonnegative.nullable(),
  peakMemoryGb: nonnegative,
  averageCpuPercent: percentage,
  averageGpuPercent: percentage.nullable(),
  estimatedCostUsd: nonnegative.nullable(),
  device: z.object({
    machineLabel: z.string().min(1).max(120),
    operatingSystem: z.string().min(1).max(120),
    cpu: z.string().min(1).max(120),
    gpu: z.string().min(1).max(120),
    memoryGb: nonnegative,
  }),
  resourceTrend: z.array(z.object({
    timestamp,
    cpuPercent: percentage,
    memoryGb: nonnegative,
    gpuPercent: percentage.nullable(),
  })).max(1200),
});

export type LocalRun = z.infer<typeof localRunSchema>;

export function parseLocalRun(contents: string): LocalRun {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error('This is not a valid JSON file.');
  }
  const result = localRunSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new Error(`Invalid telemetry run: ${first.path.join('.') || 'file'} — ${first.message}`);
  }
  return result.data;
}

export function readLocalRuns(): { runs: LocalRun[]; error: string | null } {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { runs: [], error: null };
    const parsed = z.array(localRunSchema).max(30).safeParse(JSON.parse(stored));
    if (!parsed.success) throw new Error('Saved runs are invalid. Remove them to start over.');
    return { runs: parsed.data, error: null };
  } catch (error) {
    return { runs: [], error: error instanceof Error ? error.message : 'Could not read saved runs.' };
  }
}

export function saveLocalRuns(runs: LocalRun[]): void {
  if (runs.length > 30) throw new Error('This browser can hold up to 30 imported runs. Remove older runs first.');
  localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
}

const round = (value: number) => Math.round(value * 10) / 10;
const average = (values: number[]): number | null => values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
};
const present = (values: Array<number | null>) => values.filter((value): value is number => value !== null);

export function buildImportedDashboard(
  allRuns: LocalRun[],
  scenario: 'all' | LocalRun['scenarioId'],
  windowOption: '7d' | '30d' | '90d',
): TelemetryDashboard {
  const days = { '7d': 7, '30d': 30, '90d': 90 }[windowOption];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const selected = allRuns
    .filter(run => (scenario === 'all' || run.scenarioId === scenario) && Date.parse(run.timestamp) >= cutoff)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const groups = new Map<string, LocalRun[]>();
  for (const run of selected) {
    const key = `${run.runtime}\0${run.provider}\0${run.model}`;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  const modelComparisons: ModelComparison[] = Array.from(groups.values(), group => ({
    model: group[0].model,
    provider: group[0].provider,
    runtime: group[0].runtime,
    runs: group.length,
    qualityScore: average(present(group.map(run => run.qualityScore))),
    timeToFirstTokenMs: average(present(group.map(run => run.timeToFirstTokenMs))),
    tokensPerSecond: average(present(group.map(run => run.tokensPerSecond))),
    peakMemoryGb: Math.max(...group.map(run => run.peakMemoryGb)),
    averageCpuPercent: average(group.map(run => run.averageCpuPercent)) ?? 0,
    averageGpuPercent: average(present(group.map(run => run.averageGpuPercent))),
    estimatedCostUsd: average(present(group.map(run => run.estimatedCostUsd))),
  }));
  const recentRuns: BenchmarkRun[] = selected.map(run => ({
    id: run.id, timestamp: run.timestamp, scenarioId: run.scenarioId,
    scenarioLabel: run.scenarioLabel, model: run.model, provider: run.provider,
    runtime: run.runtime, durationSeconds: run.durationSeconds,
    qualityScore: run.qualityScore, tokensPerSecond: run.tokensPerSecond,
    peakMemoryGb: run.peakMemoryGb, averageCpuPercent: run.averageCpuPercent,
    averageGpuPercent: run.averageGpuPercent, estimatedCostUsd: run.estimatedCostUsd,
  }));
  const latestDevice = (selected[0] ?? allRuns[0])?.device ?? {
    machineLabel: 'No laptop measured',
    operatingSystem: '—',
    cpu: '—',
    gpu: 'Not measured',
    memoryGb: 0,
  };
  const resourceTrend: ResourcePoint[] = selected[0]?.resourceTrend ?? [];
  return {
    dataMode: 'imported-local',
    generatedAt: selected[0]?.timestamp ?? new Date().toISOString(),
    attribution: 'Imported measurements are saved only in this browser. The benchmark runner records CPU, RAM and Ollama-reported token speed; its workload-check score is not a general model-quality rating. GPU and unsupplied values remain unavailable. An import is a snapshot, not a live connection.',
    device: latestDevice,
    collector: {
      state: allRuns.length ? 'imported-file' : 'disconnected',
      message: allRuns.length
        ? `${allRuns.length} locally measured run${allRuns.length === 1 ? '' : 's'} imported in this browser. No live collector is connected.`
        : 'No benchmark results imported yet. Run the local benchmark and import its JSON results.',
      lastSeen: selected[0]?.timestamp ?? null,
    },
    summary: {
      runs: selected.length,
      models: modelComparisons.length,
      averageQuality: average(present(selected.map(run => run.qualityScore))),
      medianTokensPerSecond: median(present(selected.map(run => run.tokensPerSecond))),
      peakMemoryGb: selected.length ? Math.max(...selected.map(run => run.peakMemoryGb)) : 0,
      localGpuObserved: selected.some(run => run.averageGpuPercent !== null),
    },
    scenarios: [
      { id: 'code-fix', label: 'Repository bug fix' },
      { id: 'summarization', label: 'Document summary' },
      { id: 'data-extraction', label: 'Structured data extraction' },
    ],
    resourceTrend,
    modelComparisons,
    recentRuns,
  };
}