import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getGetTelemetryDashboardQueryKey, useGetTelemetryDashboard, type ModelComparison } from '@workspace/api-client-react';
import { Activity, ArrowDown, ArrowUp, ArrowUpRight, Check, ChevronDown, CircleAlert, Cloud, Cpu, Download, Gauge, HardDrive, Laptop2, Moon, Printer, RefreshCw, Search, Sun } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CollectorImport } from '@/components/collector-import';
import { buildImportedDashboard, readLocalRuns, saveLocalRuns, type LocalRun } from '@/lib/local-runs';

type WindowOption = '7d' | '30d' | '90d';
type ScenarioOption = 'all' | 'code-fix' | 'summarization' | 'data-extraction';
type SortKey = 'model' | 'runtime' | 'runs' | 'qualityScore' | 'timeToFirstTokenMs' | 'tokensPerSecond' | 'peakMemoryGb' | 'averageCpuPercent' | 'averageGpuPercent' | 'estimatedCostUsd';
type ChartMetric = 'qualityScore' | 'tokensPerSecond';

const ORANGE = '#d65e32';
const TEAL = '#448d8b';
const BLUE = '#68849e';
const INTERVALS = [{ label: 'Every 5 min', ms: 300000 }, { label: 'Every 15 min', ms: 900000 }, { label: 'Every hour', ms: 3600000 }];
const metricLabel: Record<ChartMetric, string> = { qualityScore: 'Workload checks', tokensPerSecond: 'Tokens / sec' };

function csvDownload(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [keys.map(escape).join(','), ...rows.map(row => keys.map(k => escape(row[k])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const number = (value: number | null, digits = 1) => value == null ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const money = (value: number | null) => value == null ? 'Not supplied' : `$${value.toFixed(value < 0.01 && value > 0 ? 4 : 2)}`;
const ram = (gb: number) => gb > 0 && gb < 0.1 ? `${number(gb * 1024, 0)} MB` : `${number(gb)} GB`;
const time = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
};
const timeOnly = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const Skeleton = ({ className = '' }: { className?: string }) => <div className={`skeleton ${className}`} aria-hidden="true" />;

function PanelHeading({ index, title, subtitle, onExport, children }: { index: string; title: string; subtitle: string; onExport?: () => void; children?: ReactNode }) {
  return <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
    <div className="min-w-0"><div className="flex items-center gap-2.5"><span className="mono text-[10px] font-bold text-primary">{index}</span><h2 className="display text-[15px] font-bold tracking-tight">{title}</h2></div><p className="mt-1 text-[11px] text-muted-foreground">{subtitle}</p></div>
    <div className="print-hide flex shrink-0 items-center gap-2">{children}{onExport && <button data-testid={`button-export-${index}`} className="tool-button icon" title={`Export ${title} CSV`} aria-label={`Export ${title} CSV`} onClick={onExport}><Download size={14} /></button>}</div>
  </div>;
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="flex min-h-[220px] flex-col items-center justify-center px-6 text-center"><Activity className="mb-3 text-muted-foreground" size={24} /><p className="display text-sm font-bold">{title}</p><p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">{detail}</p></div>;
}

function ChartTooltip({ active, payload, label, unit = '' }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: string; unit?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-md border border-border bg-card px-3 py-2 text-foreground shadow-lg"><p className="mono mb-1.5 text-[10px] text-muted-foreground">{label}</p>{payload.filter(p => p.value != null).map((p, i) => <div key={i} className="flex items-center gap-4 py-0.5 text-[11px]"><span className="flex items-center gap-1.5"><i className="h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />{p.name}</span><strong className="mono ml-auto">{p.name?.startsWith('RAM') ? ram(Number(p.value)) : `${number(Number(p.value), 1)}${unit}`}</strong></div>)}</div>;
}

function ModelBadge({ runtime }: { runtime: string }) {
  const local = runtime === 'local';
  return <span className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold ${local ? 'bg-accent/10 text-accent' : 'bg-chart-3/10 text-chart-3'}`}>{local ? <Laptop2 size={11} /> : <Cloud size={11} />}{local ? 'LOCAL' : 'CLOUD CLIENT'}</span>;
}

export default function Dashboard() {
  const [windowOption, setWindowOption] = useState<WindowOption>('30d');
  const [scenario, setScenario] = useState<ScenarioOption>('all');
  const [dark, setDark] = useState(() => localStorage.getItem('telemetry-theme') === 'dark');
  const [refreshOpen, setRefreshOpen] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [intervalMs, setIntervalMs] = useState(300000);
  const [metric, setMetric] = useState<ChartMetric>('qualityScore');
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({ key: 'qualityScore', direction: 'desc' });
  const [search, setSearch] = useState('');
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [localState, setLocalState] = useState(readLocalRuns);
  const [source, setSource] = useState<'sample' | 'local'>('local');
  const [importError, setImportError] = useState<string | null>(null);
  const refreshRef = useRef<HTMLDivElement>(null);
  const query = useGetTelemetryDashboard({ window: windowOption, scenario }, { query: { enabled: source === 'sample', queryKey: getGetTelemetryDashboardQueryKey({ window: windowOption, scenario }), staleTime: 300000, refetchOnWindowFocus: false } });
  const { isLoading, isFetching, isError, refetch, dataUpdatedAt } = query;
  const data = source === 'local' ? buildImportedDashboard(localState.runs, scenario, windowOption) : query.data;
  const loading = source === 'sample' && (isLoading || isFetching);
  const queryError = source === 'sample' && isError;

  useEffect(() => { document.documentElement.classList.toggle('dark', dark); localStorage.setItem('telemetry-theme', dark ? 'dark' : 'light'); }, [dark]);
  useEffect(() => {
    function outside(event: MouseEvent) { if (refreshRef.current && !refreshRef.current.contains(event.target as Node)) setRefreshOpen(false); }
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, []);
  useEffect(() => {
    if (!autoRefresh || source === 'local') return;
    const id = window.setInterval(() => { void refetch(); }, Math.max(intervalMs, 300000));
    return () => clearInterval(id);
  }, [autoRefresh, intervalMs, refetch, source]);

  function importRuns(incoming: LocalRun[]) {
    const byId = new Map(localState.runs.map(run => [run.id, run]));
    for (const run of incoming) byId.set(run.id, run);
    const next = [...byId.values()].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    saveLocalRuns(next);
    setLocalState({ runs: next, error: null });
    setImportError(null);
    setSource('local');
    setSelectedRun(null);
  }

  function clearRuns() {
    saveLocalRuns([]);
    setLocalState({ runs: [], error: null });
    setImportError(null);
    setSource('local');
    setSelectedRun(null);
  }

  const comparisons = data?.modelComparisons ?? [];
  const runs = data?.recentRuns ?? [];
  const trends = data?.resourceTrend ?? [];
  const sorted = useMemo(() => comparisons.filter(m => `${m.model} ${m.provider} ${m.runtime}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => {
    const va = a[sort.key]; const vb = b[sort.key];
    if (va == null) return 1; if (vb == null) return -1;
    const diff = typeof va === 'string' ? va.localeCompare(String(vb)) : Number(va) - Number(vb);
    return sort.direction === 'asc' ? diff : -diff;
  }), [comparisons, search, sort]);
  const chartModels = useMemo(() => comparisons.filter(m => m[metric] != null).sort((a, b) => (b[metric] ?? 0) - (a[metric] ?? 0)), [comparisons, metric]);
  const currentRun = runs.find(r => r.id === selectedRun) ?? runs[0];
  const labelColor = dark ? '#aaa69a' : '#777f7c';
  const gridColor = dark ? '#354247' : '#e6e3d9';
  const toggleSort = (key: SortKey) => setSort(s => ({ key, direction: s.key === key && s.direction === 'desc' ? 'asc' : 'desc' }));
  const lastUpdated = source === 'local' ? localState.runs.length ? 'Imported snapshot' : 'No imports yet' : dataUpdatedAt ? time(new Date(dataUpdatedAt).toISOString()) : '—';

  const columns: { key: SortKey; label: string; render: (m: ModelComparison) => ReactNode }[] = [
    { key: 'model', label: 'MODEL / PROVIDER', render: m => <div><div className="font-bold text-foreground">{m.model}</div><div className="mt-0.5 text-[11px] text-muted-foreground">{m.provider}</div></div> },
    { key: 'runtime', label: 'RUNTIME', render: m => <ModelBadge runtime={m.runtime} /> },
    { key: 'runs', label: 'RUNS', render: m => number(m.runs, 0) },
    { key: 'qualityScore', label: 'CHECKS', render: m => <span className="font-bold text-primary">{m.qualityScore == null ? 'Unrated' : number(m.qualityScore)}</span> },
    { key: 'timeToFirstTokenMs', label: 'FIRST TOKEN', render: m => m.timeToFirstTokenMs == null ? '—' : `${number(m.timeToFirstTokenMs, 0)} ms` },
    { key: 'tokensPerSecond', label: 'TOKENS / S', render: m => number(m.tokensPerSecond) },
    { key: 'peakMemoryGb', label: 'PEAK RAM', render: m => ram(m.peakMemoryGb) },
    { key: 'averageCpuPercent', label: 'CPU', render: m => `${number(m.averageCpuPercent)}%` },
    { key: 'averageGpuPercent', label: 'GPU', render: m => m.averageGpuPercent == null ? <span className="text-muted-foreground" title="Not observed on this laptop; cloud server-side compute is unavailable">N/A</span> : `${number(m.averageGpuPercent)}%` },
    { key: 'estimatedCostUsd', label: 'EST. COST', render: m => money(m.estimatedCostUsd) },
  ];

  return <div className="min-h-[100dvh] bg-background text-foreground">
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-[1540px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-7 lg:px-10">
        <div className="flex items-center gap-3"><div className="flex h-8 w-8 items-center justify-center rounded bg-foreground text-background"><Activity size={18} strokeWidth={2.5} /></div><div className="display text-[15px] font-extrabold leading-none tracking-tight">MODEL<span className="text-primary">/</span>TELEMETRY</div><span className="ml-2 hidden border-l border-border pl-4 text-[11px] text-muted-foreground sm:inline">Performance intelligence</span></div>
        <div className="flex items-center gap-2 print-hide">
          <span className="mr-3 hidden items-center gap-1.5 text-[10px] text-muted-foreground md:flex"><span className="h-1.5 w-1.5 rounded-full bg-primary" />{source === 'local' ? localState.runs.length ? 'IMPORTED MEASUREMENTS' : 'AWAITING BENCHMARK RESULTS' : 'SAMPLE ENVIRONMENT'}</span>
          {source === 'sample' && <div className="relative" ref={refreshRef}>
            <div className="flex"><button data-testid="button-refresh" onClick={() => void refetch()} disabled={loading} className="tool-button rounded-r-none border-r-0" title="Refresh data"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh</button><button data-testid="button-refresh-options" onClick={() => setRefreshOpen(o => !o)} aria-label="Auto-refresh options" aria-expanded={refreshOpen} className="tool-button icon w-7 rounded-l-none"><ChevronDown size={13} /></button></div>
            {refreshOpen && <div className="absolute right-0 top-10 z-30 w-[220px] rounded-md border border-border bg-popover p-2 shadow-xl">
              <button data-testid="button-auto-refresh" onClick={() => setAutoRefresh(v => !v)} className="flex w-full items-center justify-between rounded px-2 py-2 text-left text-xs hover:bg-muted"><span>Auto-refresh <span className="block text-[10px] text-muted-foreground">{autoRefresh ? 'On' : 'Off by default'}</span></span><span className={`relative h-[18px] w-8 rounded-full transition-colors ${autoRefresh ? 'bg-primary' : 'bg-border'}`}><span className={`absolute top-[3px] h-3 w-3 rounded-full bg-card transition-transform ${autoRefresh ? 'translate-x-[17px]' : 'translate-x-[3px]'}`} /></span></button>
              <div className="my-1 border-t border-border" /><p className="eyebrow px-2 py-1">Interval · 5 min minimum</p>
              {INTERVALS.map(option => <button key={option.ms} data-testid={`button-interval-${option.ms}`} onClick={() => { setIntervalMs(option.ms); setAutoRefresh(true); setRefreshOpen(false); }} className="flex w-full items-center justify-between rounded px-2 py-1.5 text-xs hover:bg-muted">{option.label}{intervalMs === option.ms && <Check size={13} className="text-primary" />}</button>)}
            </div>}
          </div>}
          <button data-testid="button-export-pdf" onClick={() => window.print()} disabled={loading || !data} className="tool-button icon" aria-label="Export PDF" title="Export PDF"><Printer size={14} /></button>
          <button data-testid="button-toggle-theme" onClick={() => setDark(v => !v)} className="tool-button icon" aria-label={dark ? 'Use light mode' : 'Use dark mode'} title={dark ? 'Light mode' : 'Dark mode'}>{dark ? <Sun size={14} /> : <Moon size={14} />}</button>
        </div>
      </div>
    </header>

    <main className="mx-auto max-w-[1540px] px-4 pb-14 pt-7 sm:px-7 lg:px-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-5">
        <div><div className="eyebrow mb-2 flex items-center gap-2"><span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" /> LOCAL MODEL BENCHMARKS <span className="text-border">/</span> 01 OVERVIEW</div><h1 className="display text-[32px] font-extrabold leading-[1.05] tracking-[-.055em] sm:text-[41px]">Choose with evidence<span className="text-primary">.</span></h1><p className="mt-2.5 max-w-[740px] text-[13px] leading-5 text-muted-foreground">Run identical workloads across quantized open models on your laptop, then compare measured speed, CPU and RAM.</p></div>
        <div className="mono text-[10px] leading-5 text-muted-foreground"><div>LAST REFRESH <span data-testid="text-last-refreshed" className="ml-2 text-foreground">{lastUpdated}</span></div><div>GENERATED <span data-testid="text-generated-at" className="ml-2 text-foreground">{data && (source === 'sample' || localState.runs.length) ? time(data.generatedAt) : '—'}</span></div></div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2.5 rounded-md border border-primary/35 bg-primary/[.065] px-3.5 py-2.5 sm:gap-4">
         <span data-testid="status-data-mode" className="mono inline-flex shrink-0 items-center gap-2 rounded border border-primary/30 bg-card px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-primary"><CircleAlert size={12} />{source === 'local' ? localState.runs.length ? 'Imported local measurements' : 'No benchmark results yet' : data?.dataMode === 'illustrative-sample' ? 'Illustrative sample data' : loading ? 'Checking data mode' : 'Data mode unavailable'}</span>
         <p className="flex-1 text-[11px] leading-4 text-foreground/80">{source === 'local' ? localState.runs.length ? 'CPU and RAM are process samples from your imported files. Token speed is Ollama-reported when benchmarked; GPU remains unavailable.' : 'Download the local runner below, benchmark models on your computer, and import its JSON results. No example figures are shown by default.' : 'These figures illustrate the interface. Do not use them as measured evidence for a production model decision.'}</p>
        <span data-testid="status-collector" className="mono inline-flex shrink-0 items-center gap-2 text-[10px] font-bold uppercase text-primary"><span className="signal-dot h-1.5 w-1.5 rounded-full bg-primary" />Collector: {data?.collector.state ?? 'checking'}</span>
      </div>

       <CollectorImport
         importedCount={localState.runs.length}
         source={source}
         onSourceChange={setSource}
         onImport={importRuns}
         onClear={clearRuns}
         storageError={importError || localState.error}
       />

      <div className="mb-5 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
        <div><p className="eyebrow mb-2">SCENARIO</p><div className="flex flex-wrap gap-1.5 print-hide">
          {([{ id: 'all', label: 'All scenarios' }, ...(data?.scenarios ?? [{ id: 'code-fix', label: 'Code fix' }, { id: 'summarization', label: 'Document summary' }, { id: 'data-extraction', label: 'Data extraction' }]) ] as { id: ScenarioOption; label: string }[]).map(item => <button data-testid={`button-scenario-${item.id}`} key={item.id} onClick={() => setScenario(item.id)} aria-pressed={scenario === item.id} className={`rounded border px-3 py-[7px] text-[11px] font-bold transition-colors ${scenario === item.id ? 'border-foreground bg-foreground text-background' : 'border-border bg-card text-muted-foreground hover:border-foreground hover:text-foreground'}`}>{item.label}</button>)}
          <span className="hidden rounded border border-border px-3 py-[7px] text-[11px] font-bold sm:print:inline">{scenario === 'all' ? 'All scenarios' : scenario}</span>
        </div></div>
        <div><p className="eyebrow mb-2 lg:text-right">TIME WINDOW</p><div className="inline-flex overflow-hidden rounded border border-border bg-card print-hide">{(['7d', '30d', '90d'] as WindowOption[]).map(option => <button data-testid={`button-window-${option}`} key={option} onClick={() => setWindowOption(option)} aria-pressed={windowOption === option} className={`mono border-r border-border px-3 py-[7px] text-[10px] font-bold last:border-r-0 transition-colors ${windowOption === option ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{option.toUpperCase()}</button>)}</div><span className="hidden text-xs print:inline">{windowOption}</span></div>
      </div>

       {queryError && !loading ? <div className="panel mb-5 flex flex-wrap items-center justify-between gap-4 border-destructive/30 bg-destructive/5 p-6"><div><h2 className="display font-bold">Telemetry could not be loaded</h2><p className="mt-1 text-sm text-muted-foreground">The dashboard request failed. Check the API connection and try again.</p></div><button data-testid="button-retry" className="tool-button" onClick={() => void refetch()}><RefreshCw size={14} /> Retry</button></div> : null}

      <section aria-label="Summary metrics" className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: 'BENCHMARK RUNS', value: data ? number(data.summary.runs, 0) : '—', detail: `${data?.summary.models ?? '—'} models in comparison`, icon: Activity },
          { label: 'WORKLOAD CHECKS', value: data ? data.summary.averageQuality == null ? data.summary.runs ? 'Unrated' : '—' : `${number(data.summary.averageQuality)}/100` : '—', detail: 'Fixed checks, not a general rating', icon: Gauge },
          { label: 'MEDIAN THROUGHPUT', value: data ? data.summary.medianTokensPerSecond == null ? '—' : number(data.summary.medianTokensPerSecond) : '—', detail: 'generated tokens per second', icon: ArrowUpRight },
          { label: 'PEAK LAPTOP RAM', value: data && (source === 'sample' || data.summary.runs) ? ram(data.summary.peakMemoryGb) : '—', detail: source === 'local' ? 'From imported process samples' : 'Illustrative example only', icon: HardDrive },
          { label: 'LOCAL GPU', value: data ? source === 'sample' ? 'Example' : !data.summary.runs ? '—' : data.summary.localGpuObserved ? 'Observed' : 'N/A' : '—', detail: source === 'local' ? 'Not captured by local runner' : 'Illustrative example only', icon: Cpu },
        ].map((item, i) => <div key={item.label} className="panel relative min-h-[119px] overflow-hidden px-4 py-3.5"><div className="absolute right-0 top-0 h-full w-[3px] bg-primary/70 opacity-0 transition-opacity hover:opacity-100" /><div className="flex items-center justify-between"><span className="eyebrow">{item.label}</span><item.icon size={14} className="text-muted-foreground" /></div>{loading ? <><Skeleton className="mt-4 h-8 w-2/3" /><Skeleton className="mt-2 h-3 w-1/2" /></> : <><p data-testid={`text-kpi-${i}`} className="display mt-3 whitespace-nowrap text-[26px] font-extrabold leading-none tracking-[-.055em] text-primary">{item.value}</p><p className="mt-2 text-[10px] text-muted-foreground">{item.detail}</p></>}</div>)}
      </section>

      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.18fr)_minmax(0,1fr)] print-grid">
        <section className="panel min-w-0">
          <PanelHeading index="01" title="Laptop resource trace" subtitle={source === 'local' ? 'CPU and memory from the latest imported run' : 'Illustrative trace; not read from your laptop'} onExport={!loading && trends.length ? () => csvDownload('laptop-resource-trace.csv', trends as unknown as Record<string, unknown>[]) : undefined} />
          <div className="px-3 pb-3 pt-4 sm:px-5">
            <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[10px] font-bold text-muted-foreground"><span><i className="mr-1.5 inline-block h-[3px] w-4 align-middle" style={{ background: ORANGE }} />CPU %</span><span><i className="mr-1.5 inline-block h-[3px] w-4 align-middle" style={{ background: TEAL }} />RAM GB</span>{data?.summary.localGpuObserved && <span><i className="mr-1.5 inline-block h-[3px] w-4 align-middle" style={{ background: BLUE }} />GPU %</span>}</div>
            {loading ? <Skeleton className="h-[238px] w-full" /> : trends.length ? <div className="h-[238px] w-full" data-testid="chart-resource-trend"><ResponsiveContainer width="100%" height="100%" debounce={0}><AreaChart data={trends} margin={{ top: 8, right: 8, bottom: 0, left: -26 }}><defs><linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={ORANGE} stopOpacity={0.18} /><stop offset="100%" stopColor={ORANGE} stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke={gridColor} strokeDasharray="3 4" vertical={false} /><XAxis dataKey="timestamp" tickFormatter={timeOnly} stroke={gridColor} tick={{ fill: labelColor, fontSize: 10 }} tickLine={false} minTickGap={22} /><YAxis yAxisId="pct" tickFormatter={v => `${v}%`} stroke={gridColor} tick={{ fill: labelColor, fontSize: 10 }} tickLine={false} axisLine={false} domain={[0, 100]} /><YAxis yAxisId="ram" orientation="right" tickFormatter={v => `${v}G`} stroke={gridColor} tick={{ fill: labelColor, fontSize: 10 }} tickLine={false} axisLine={false} width={35} /><Tooltip content={<ChartTooltip />} isAnimationActive={false} labelFormatter={v => time(String(v))} /><Area yAxisId="pct" type="monotone" dataKey="cpuPercent" name="CPU %" stroke={ORANGE} strokeWidth={2} fill="url(#cpuGradient)" isAnimationActive={false} dot={false} activeDot={{ r: 4 }} /><Area yAxisId="ram" type="monotone" dataKey="memoryGb" name="RAM GB" stroke={TEAL} strokeWidth={2} fill="transparent" isAnimationActive={false} dot={false} activeDot={{ r: 4 }} />{data?.summary.localGpuObserved && <Area yAxisId="pct" type="monotone" dataKey="gpuPercent" name="GPU %" stroke={BLUE} strokeWidth={2} fill="transparent" isAnimationActive={false} dot={false} activeDot={{ r: 4 }} />}</AreaChart></ResponsiveContainer></div> : <Empty title="No resource samples" detail="There are no laptop-side resource observations for this selection." />}
            <p className="mt-2 border-t border-border pt-2 text-[10px] leading-4 text-muted-foreground"><strong className="text-foreground">Scope:</strong> {source === 'local' ? 'Trace from the most recent imported run. CPU and RAM are from monitored processes; GPU appears only if separately supplied.' : 'Illustrative trace, not a reading from your laptop.'} Cloud provider infrastructure is never measured here.</p>
          </div>
        </section>

        <section className="panel min-w-0">
          <PanelHeading index="02" title="Model comparison" subtitle={`${metricLabel[metric]} across the selected models`} onExport={!loading && chartModels.length ? () => csvDownload('model-comparison.csv', chartModels as unknown as Record<string, unknown>[]) : undefined}>
            <div className="flex overflow-hidden rounded border border-border"><button data-testid="button-chart-quality" onClick={() => setMetric('qualityScore')} className={`px-2 py-1 text-[10px] font-bold ${metric === 'qualityScore' ? 'bg-foreground text-background' : 'hover:bg-muted'}`}>CHECKS</button><button data-testid="button-chart-speed" onClick={() => setMetric('tokensPerSecond')} className={`border-l border-border px-2 py-1 text-[10px] font-bold ${metric === 'tokensPerSecond' ? 'bg-foreground text-background' : 'hover:bg-muted'}`}>SPEED</button></div>
          </PanelHeading>
          <div className="px-3 pb-3 pt-4 sm:px-5">
            <div className="mb-2 flex flex-wrap items-center gap-4 text-[10px] font-bold text-muted-foreground"><span><i className="mr-1.5 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: ORANGE }} />Local runtime</span><span><i className="mr-1.5 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: BLUE }} />Cloud client</span></div>
            {loading ? <Skeleton className="h-[238px] w-full" /> : chartModels.length ? <div className="h-[238px] w-full" data-testid="chart-model-comparison"><ResponsiveContainer width="100%" height="100%" debounce={0}><BarChart data={chartModels} layout="vertical" margin={{ top: 4, right: 20, bottom: 0, left: 0 }}><CartesianGrid stroke={gridColor} strokeDasharray="3 4" horizontal={false} /><XAxis type="number" domain={[0, metric === 'qualityScore' ? 100 : 'auto']} stroke={gridColor} tick={{ fill: labelColor, fontSize: 10 }} tickLine={false} axisLine={false} /><YAxis dataKey="model" type="category" width={116} stroke={gridColor} tick={{ fill: labelColor, fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => String(v).length > 17 ? `${String(v).slice(0, 16)}…` : String(v)} /><Tooltip cursor={false} content={<ChartTooltip />} isAnimationActive={false} /><Bar dataKey={metric} name={metricLabel[metric]} barSize={15} radius={[0, 3, 3, 0]} isAnimationActive={false}>{chartModels.map((m, i) => <Cell key={`${m.model}-${i}`} fill={m.runtime === 'local' ? ORANGE : BLUE} />)}</Bar></BarChart></ResponsiveContainer></div> : <Empty title={source === 'local' && comparisons.length ? `No ${metric === 'qualityScore' ? 'workload scores' : 'token-speed readings'} recorded` : 'No models in this selection'} detail={source === 'local' && comparisons.length ? 'Those values were not recorded for the selected runs.' : 'Run the local benchmark and import its results, or change the scenario and time window.'} />}
            <p className="mt-2 border-t border-border pt-2 text-[10px] leading-4 text-muted-foreground">The fixed workload checks are not a general quality rating. Benchmark token speed comes from Ollama generation statistics; higher is better.</p>
          </div>
        </section>
      </div>

      <section className="panel mb-4 overflow-hidden">
        <PanelHeading index="03" title="Comparison matrix" subtitle="Sort any column to examine the trade-offs behind each result">
          <label className="flex h-8 w-[155px] items-center gap-1.5 rounded border border-border bg-background px-2 sm:w-[190px]"><Search size={13} className="shrink-0 text-muted-foreground" /><input data-testid="input-search-models" value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a model" className="w-full bg-transparent text-[11px] outline-none placeholder:text-muted-foreground" /></label>
        </PanelHeading>
        <div className="scrollbar-thin overflow-x-auto">
          {loading ? <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div> : comparisons.length ? <table className="w-full min-w-[1110px] border-collapse text-left" data-testid="table-comparisons"><thead><tr className="bg-muted/45">{columns.map(c => <th key={c.key} className="border-b border-border px-3 py-2.5 first:pl-5"><button data-testid={`button-sort-${c.key}`} onClick={() => toggleSort(c.key)} aria-label={`Sort by ${c.label}`} className={`mono flex items-center gap-1 whitespace-nowrap text-[9px] font-bold tracking-wide transition-colors hover:text-primary ${sort.key === c.key ? 'text-primary' : 'text-muted-foreground'}`}>{c.label}{sort.key === c.key ? sort.direction === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} /> : <span className="opacity-30">↕</span>}</button></th>)}</tr></thead><tbody>{sorted.map((m, i) => <tr key={`${m.provider}-${m.model}-${i}`} data-testid={`row-comparison-${i}`} className="table-row border-b border-border/70 last:border-b-0">{columns.map(c => <td key={c.key} className="mono whitespace-nowrap px-3 py-3 text-[11px] first:pl-5">{c.render(m)}</td>)}</tr>)}</tbody></table> : <Empty title="No comparisons yet" detail="No model comparisons are available for this scenario and time window." />}
          {!loading && comparisons.length > 0 && sorted.length === 0 && <Empty title="No matching models" detail="Try a different search term to find a model or provider." />}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-2.5 text-[10px] text-muted-foreground"><span>Showing {sorted.length} of {comparisons.length} models</span><span>CPU / RAM / GPU refer to laptop-side observations only</span></div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.36fr)_minmax(330px,.64fr)] print-grid">
        <section className="panel min-w-0 overflow-hidden"><PanelHeading index="04" title="Recent benchmark runs" subtitle="Select a run to inspect its context" /><div className="scrollbar-thin max-h-[336px] overflow-auto">
          {loading ? <div className="space-y-2 p-4">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div> : runs.length ? runs.map((run, i) => <button key={run.id} data-testid={`button-run-${run.id}`} onClick={() => setSelectedRun(run.id)} className={`table-row flex w-full items-center gap-3 border-b border-border/70 px-4 py-3 text-left last:border-b-0 sm:px-5 ${currentRun?.id === run.id ? 'selected' : ''}`}><span className="mono w-5 shrink-0 text-[10px] text-muted-foreground">{String(i + 1).padStart(2, '0')}</span><div className="min-w-0 flex-1"><div className="truncate text-[12px] font-bold">{run.model}</div><div className="mt-0.5 truncate text-[10px] text-muted-foreground">{run.scenarioLabel} <span className="px-1">·</span> {run.provider}</div></div><div className="hidden shrink-0 sm:block"><ModelBadge runtime={run.runtime} /></div><div className="mono w-[54px] shrink-0 text-right text-[11px] font-bold text-primary">{run.qualityScore == null ? '—' : number(run.qualityScore)}</div><div className="mono hidden w-[76px] shrink-0 text-right text-[10px] text-muted-foreground md:block">{time(run.timestamp)}</div><ArrowUpRight size={13} className="shrink-0 text-muted-foreground" /></button>) : <Empty title="No recent runs" detail="No benchmark runs are available for this scenario and time window." />}
        </div></section>
        <aside className="panel min-w-0"><PanelHeading index="05" title="Run inspection" subtitle={currentRun ? `Run ${currentRun.id}` : 'Select a run to inspect'} />
          {loading ? <div className="space-y-3 p-5">{Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-5 w-full" />)}</div> : currentRun ? <div className="px-5 py-4" data-testid="detail-run"><div className="flex items-start justify-between gap-2"><div><p className="eyebrow mb-1">SELECTED RUN</p><h3 className="display text-[18px] font-bold leading-tight">{currentRun.model}</h3><p className="mt-1 text-[11px] text-muted-foreground">{currentRun.provider} · {currentRun.scenarioLabel}</p></div><ModelBadge runtime={currentRun.runtime} /></div><div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 border-y border-border py-3">{[
             ['CHECKS', currentRun.qualityScore == null ? 'Unrated' : `${number(currentRun.qualityScore)}/100`], ['THROUGHPUT', currentRun.tokensPerSecond == null ? 'Not captured' : `${number(currentRun.tokensPerSecond)} tok/s`], ['DURATION', `${number(currentRun.durationSeconds)} s`], ['EST. COST', money(currentRun.estimatedCostUsd)], ['PEAK LAPTOP RAM', ram(currentRun.peakMemoryGb)], ['LAPTOP CPU', `${number(currentRun.averageCpuPercent)}%`], ['LAPTOP GPU', currentRun.averageGpuPercent == null ? 'Not observed' : `${number(currentRun.averageGpuPercent)}%`], ['STARTED', time(currentRun.timestamp)],
          ].map(([label, value]) => <div key={label}><p className="eyebrow !text-[9px]">{label}</p><p className="mono mt-1 text-[11px] font-bold" data-testid={`text-run-${label.toLowerCase().replaceAll(' ', '-')}`}>{value}</p></div>)}</div><p className="mt-3 text-[10px] leading-4 text-muted-foreground">{currentRun.runtime === 'cloud-client' ? 'Cloud client metrics reflect this laptop only. Provider server-side GPU and CPU usage is unavailable.' : 'Resource metrics reflect the local runtime as observed on this laptop.'}</p></div> : <Empty title="Select a run" detail="Choose a benchmark run to inspect its quality, speed and laptop-side resource use." />}
        </aside>
      </div>

       <footer className="mt-5 grid gap-4 border-t border-border pt-4 md:grid-cols-[1fr_auto]"><div><p className="eyebrow mb-1.5">MEASUREMENT BOUNDARY</p><p className="max-w-[920px] text-[11px] leading-[1.65] text-muted-foreground">{source === 'local' ? 'Imported CPU and RAM are sampled from the monitored command and optional named local processes. GPU is unavailable unless separately recorded.' : 'The displayed CPU, RAM and GPU figures are illustrative samples, not actual readings.'} For cloud-client tools, laptop figures describe the local client process, <strong className="text-foreground">not cloud server compute</strong>. Provider server-side GPU and CPU usage is unavailable. {data?.attribution}</p>{data?.collector.message && <p className="mt-2 text-[10px] text-primary" data-testid="text-collector-message">Collector: {data.collector.message}{data.collector.lastSeen ? ` · Last seen ${time(data.collector.lastSeen)}` : ' · No last-seen timestamp'}</p>}</div><div className="md:text-right"><p className="eyebrow mb-1.5">{source === 'local' ? 'LAST IMPORTED DEVICE' : 'EXAMPLE DEVICE'}</p><p data-testid="text-device" className="mono text-[10px] leading-[1.7] text-muted-foreground">{data ? <>{data.device.machineLabel} · {data.device.operatingSystem}<br />{data.device.cpu} · {data.device.gpu}<br />{number(data.device.memoryGb, 0)} GB installed RAM</> : 'Device details unavailable'}</p></div></footer>
    </main>
  </div>;
}