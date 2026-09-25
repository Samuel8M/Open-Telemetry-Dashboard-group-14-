import { useState, type ReactNode } from 'react';
import { Link } from 'wouter';

export const MODELS = [
  { id: 'smollm2-135m', name: 'SmolLM2 135M', size: 'Smallest', note: 'A good first try', repository: 'HuggingFaceTB/SmolLM2-135M-Instruct' },
  { id: 'qwen2.5-0.5b', name: 'Qwen2.5 0.5B', size: 'Medium', note: 'Needs more memory', repository: 'Qwen/Qwen2.5-0.5B-Instruct' },
  { id: 'qwen2.5-1.5b', name: 'Qwen2.5 1.5B', size: 'Larger', note: 'A GPU helps', repository: 'Qwen/Qwen2.5-1.5B-Instruct' },
] as const;
export type ModelId = typeof MODELS[number]['id'];

export function useSelectedModel() {
  const [modelId, setModelId] = useState<ModelId>(() => {
    try {
      const stored = localStorage.getItem('model-telemetry:workshop-model');
      return MODELS.find(model => model.id === stored)?.id ?? MODELS[0].id;
    } catch { return MODELS[0].id; }
  });
  function selectModel(id: ModelId) {
    setModelId(id);
    try { localStorage.setItem('model-telemetry:workshop-model', id); } catch { /* Storage may be unavailable. */ }
  }
  return { modelId, selectModel, model: MODELS.find(model => model.id === modelId) ?? MODELS[0] };
}

export function FlowPage({ step, title, description, children, back, next }: {
  step: 1 | 2 | 3;
  title: string;
  description: string;
  children: ReactNode;
  back?: string;
  next?: string;
}) {
  return <main className="min-h-[100dvh] bg-background px-5 pb-12 pt-8 text-foreground sm:px-8 sm:pt-12">
    <div className="mx-auto flex min-h-[calc(100dvh-5rem)] max-w-[680px] flex-col">
      <header className="text-center">
        <p className="mono text-xs font-bold uppercase tracking-[.2em] text-primary">A little guide to model weights</p>
        <p className="mt-8 text-sm font-bold text-muted-foreground">Step {step} of 3</p>
        <h1 className="display mt-3 text-[clamp(2.6rem,7vw,4.5rem)] font-bold leading-[1.05] tracking-[-.06em]">{title}</h1>
        <p className="mx-auto mt-5 max-w-[560px] text-lg leading-relaxed text-muted-foreground sm:text-xl">{description}</p>
      </header>
      <div className="mx-auto mt-10 w-full max-w-[560px] flex-1 sm:mt-14">{children}</div>
      <nav aria-label="Workshop steps" className="mx-auto mt-12 flex w-full max-w-[560px] items-center justify-between border-t border-border pt-5 text-sm font-bold">
        {back ? <Link href={back} data-testid="link-back" className="text-foreground underline-offset-4 hover:underline">← Back</Link> : <span />}
        {next && <Link href={next} data-testid="link-next" className="text-primary underline-offset-4 hover:underline">Next →</Link>}
      </nav>
    </div>
  </main>;
}

export function CopyCommand({ command, action, testId }: { command: string; action: string; testId: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setError('');
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      setCopied(false);
      setError('Copy was blocked. Select the command below and copy it yourself.');
    }
  }
  return <div className="text-center">
    <button type="button" data-testid={testId} onClick={copy} className="inline-flex min-h-16 w-full items-center justify-center rounded-xl bg-primary px-6 text-center text-lg font-bold text-primary-foreground transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary sm:text-xl">{copied ? 'Copied!' : action}</button>
    <p data-testid={`text-command-${testId}`} className="mt-4 break-all font-mono text-xs leading-relaxed text-muted-foreground sm:text-sm">{command}</p>
    {error && <p role="alert" data-testid={`error-${testId}`} className="mt-3 text-sm text-destructive">{error}</p>}
  </div>;
}