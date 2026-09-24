import { useRef, useState } from 'react';
import { Download, FileUp, Laptop2, Trash2 } from 'lucide-react';
import { parseLocalRun, type LocalRun } from '@/lib/local-runs';

interface CollectorImportProps {
  importedCount: number;
  source: 'sample' | 'local';
  onSourceChange: (source: 'sample' | 'local') => void;
  onImport: (runs: LocalRun[]) => void;
  onClear: () => void;
  storageError: string | null;
}

export function CollectorImport({
  importedCount, source, onSourceChange, onImport, onClear, storageError,
}: CollectorImportProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setBusy(true);
    try {
      if (files.length > 30) throw new Error('Import at most 30 run files at once.');
      const parsed: LocalRun[] = [];
      for (const file of Array.from(files)) {
        if (file.size > 2_000_000) throw new Error(`${file.name} is too large (2 MB maximum).`);
        try {
          parsed.push(parseLocalRun(await file.text()));
        } catch (reason) {
          throw new Error(`${file.name}: ${reason instanceof Error ? reason.message : 'Could not import file.'}`);
        }
      }
      onImport(parsed);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not import telemetry.');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
      setBusy(false);
    }
  }

  return (
    <section className="panel mb-5 px-4 py-4 sm:px-5" aria-label="Run and import local benchmarks">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Laptop2 size={17} className="text-primary" />
            <h2 className="display text-[15px] font-bold">Benchmark on your laptop</h2>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            Download the local runner, install Ollama and Python, then benchmark the same prompts across quantized models on macOS or Windows. Downloads require your explicit command. Import the resulting JSON files here; they stay in this browser.
          </p>
        </div>
        <div className="print-hide flex flex-wrap items-center gap-2">
          <a className="tool-button" href={`${import.meta.env.BASE_URL}benchmark.py`} download="benchmark.py"><Download size={13} /> Benchmark runner</a>
          <a className="tool-button" href={`${import.meta.env.BASE_URL}benchmark-readme.txt`} download="benchmark-readme.txt"><Download size={13} /> Setup guide</a>
          <input ref={inputRef} type="file" accept=".json,application/json" multiple className="hidden" aria-label="Choose run JSON files" onChange={event => void handleFiles(event.target.files)} />
          <button className="tool-button" data-testid="button-import-runs" disabled={busy} onClick={() => inputRef.current?.click()}><FileUp size={13} /> {busy ? 'Importing…' : 'Import benchmark JSON'}</button>
        </div>
      </div>
      <div className="mt-3 rounded border border-border bg-muted/40 px-3 py-2 text-[11px] leading-5">
        <span className="font-bold text-foreground">First run after installing Ollama and psutil:</span>
        <div className="mono mt-1 flex flex-wrap gap-x-6 gap-y-1 text-[10px] text-foreground">
          <span>macOS: <code>python3 benchmark.py --pull</code></span>
          <span>Windows: <code>py benchmark.py --pull</code></span>
        </div>
        <p className="text-muted-foreground">This asks before downloading the two small default models, then creates six result files in telemetry-runs. Select those files together to import them.</p>
      </div>
      <details className="mt-3 border-t border-border pt-3 text-[11px] leading-5 text-muted-foreground">
        <summary className="cursor-pointer font-bold text-foreground">What the benchmark does</summary>
        <div className="mt-2 space-y-1">
          <p>1. Install Ollama and Python 3 on your laptop. Download both files and follow the setup guide to install <code className="mono rounded bg-muted px-1.5 py-0.5">psutil</code>.</p>
          <p>2. The runner checks available RAM and disk before optional downloads, then runs identical code-fix, summarization, and extraction prompts against your selected Ollama models. Start with small 1B models; Mistral and Phi require more memory and storage.</p>
          <p>3. Import the generated JSON files together. CPU and RAM reflect local Ollama processes. Token speed comes from Ollama generation statistics. GPU is not measured by this portable runner. Fixed workload scores are limited checks, not comprehensive model-quality ratings.</p>
        </div>
      </details>
      <details className="mt-3 border-t border-border pt-3 text-[11px] leading-5 text-muted-foreground">
        <summary className="cursor-pointer font-bold text-foreground">Advanced: measure your own command</summary>
        <p className="mt-2">For a custom CLI command, use the older manual wrapper instead of the standardized Ollama benchmark. It does not download models or calculate token speed.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <a className="tool-button" href={`${import.meta.env.BASE_URL}collector.py`} download="collector.py"><Download size={13} /> Manual collector</a>
          <a className="tool-button" href={`${import.meta.env.BASE_URL}collector-readme.txt`} download="collector-readme.txt"><Download size={13} /> Manual instructions</a>
        </div>
      </details>
      <div className="print-hide mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-[11px]">
        <span className="text-muted-foreground">{importedCount} run{importedCount === 1 ? '' : 's'} saved in this browser</span>
        <button className={`rounded border px-2 py-1 font-bold ${source === 'local' ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted'}`} onClick={() => onSourceChange('local')}>My measurements</button>
        <button className={`rounded border px-2 py-1 font-bold ${source === 'sample' ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted'}`} onClick={() => onSourceChange('sample')}>Example data</button>
        {importedCount > 0 && <button className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-destructive" onClick={() => { if (window.confirm('Remove all locally imported runs from this browser?')) onClear(); }}><Trash2 size={12} /> Remove imported runs</button>}
      </div>
      {(error || storageError) && <p role="alert" className="mt-3 rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">{error || storageError}</p>}
    </section>
  );
}