import { useRef, useState, type ChangeEvent } from 'react';
import { FlowPage, useSelectedModel } from '@/components/workshop-flow';
import { parseWeightReport, type WeightReport } from '@/lib/workshop/weight-report';

const explainRole = (role: string) => ({
  embedding: 'This group helps turn pieces of text into numbers.',
  attention: 'This group helps the model notice related words.',
  feed_forward: 'This group helps process what the model noticed.',
  normalization: 'This group helps keep numbers in a useful range.',
  output: 'This group helps turn numbers into a guess for the next word.',
} as Record<string, string>)[role] ?? 'This is one group of the model’s numbers.';

export default function ModelInterpret() {
  const { modelId, model } = useSelectedModel();
  const [report, setReport] = useState<WeightReport | null>(null);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  async function importReport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setReport(null);
    setError('');
    if (file.size > 2_000_000) {
      setError('That file is too big. Choose a JSON report under 2 MB.');
      return;
    }
    try {
      setReport(parseWeightReport(JSON.parse(await file.text()) as unknown));
    } catch (reason) {
      setError(reason instanceof SyntaxError ? 'That is not a JSON report. Try the file made by the helper.' : reason instanceof Error ? reason.message : 'Could not read that report.');
    }
  }

  const tensor = report?.tensors[0];
  return <FlowPage step={2} title="Interpret weights." description="Make a small report on your computer, then open it here to see what the numbers describe." back="/" next="/adjust">
    <input ref={input} type="file" accept=".json,application/json" className="sr-only" data-testid="input-weight-report" aria-label="Choose weight report JSON" onChange={importReport} />
    <button type="button" data-testid="button-import-report" onClick={() => input.current?.click()} className="inline-flex min-h-16 w-full items-center justify-center rounded-xl bg-primary px-6 text-center text-lg font-bold text-primary-foreground transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary sm:text-xl">Open my JSON report</button>
    <p className="mt-4 text-center text-sm leading-6 text-muted-foreground">Your report is read in this tab only. It is not uploaded or saved.</p>
    {error && <p role="alert" data-testid="error-report" className="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-base text-destructive">{error}</p>}
    {report && <section data-testid="report-details" className="mt-8 rounded-2xl border border-border bg-card p-6 sm:p-8">
      <p className="mono text-xs font-bold uppercase tracking-wider text-primary">Your report</p>
      <p className="mt-5 text-base text-muted-foreground">Model</p>
      <p data-testid="text-report-model" className="display break-words text-2xl font-bold">{report.model}</p>
      <p className="mt-6 text-base text-muted-foreground">Number of weights</p>
      <p data-testid="text-report-parameters" className="display text-3xl font-bold">{report.parameterCount.toLocaleString('en-US')}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">Each weight is a number that helps the model make a guess. One number is not a readable fact.</p>
      {report.repository !== model.repository && <p data-testid="warning-report-mismatch" className="mt-6 rounded-lg bg-secondary p-4 text-sm leading-6">This report is for a different model than the one you picked. These numbers come from the file you opened.</p>}
      {tensor && <div className="mt-7 border-t border-border pt-6">
        <p className="text-base font-bold">One group of weights</p>
        <p data-testid="text-tensor-label" className="mt-2 text-base leading-7 text-muted-foreground">{explainRole(tensor.role)}</p>
      </div>}
    </section>}
    {!report && !error && <p data-testid="empty-report" className="mt-8 text-center text-base leading-7 text-muted-foreground">No report open yet. Make one with the helper, then choose the JSON file here.</p>}
    <details className="mt-8 border-t border-border pt-5 text-base">
      <summary data-testid="details-inspect" className="cursor-pointer font-bold text-primary">Learn more: how to make a report</summary>
      <p className="mt-4 leading-7 text-muted-foreground">After downloading {model.name}, run this in the helper’s folder. The helper makes <strong>weight-report.json</strong> on your computer.</p>
      <code data-testid="text-command-inspect" className="mt-4 block select-text break-all rounded-xl bg-secondary p-4 font-mono text-sm leading-6 text-foreground">python private-model.py inspect --model {modelId} --output weight-report.json</code>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">Need help getting started? See the <a href={`${import.meta.env.BASE_URL}private-model-readme.txt`} target="_blank" rel="noreferrer" data-testid="link-setup-guide" className="font-bold text-primary underline underline-offset-4">setup guide</a>.</p>
    </details>
  </FlowPage>;
}