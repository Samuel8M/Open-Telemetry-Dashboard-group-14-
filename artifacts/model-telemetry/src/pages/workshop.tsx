import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { ArrowDownRight, ArrowRight, BookOpen, Check, ChevronRight, CircleAlert, Clipboard, Cpu, Download, FileJson2, HardDrive, Info, Laptop, LockKeyhole, RotateCcw, Sparkles, Terminal, Upload, X } from 'lucide-react';
import { generate, initialWeights, loss, probabilities, TOKENS, train, type Weights } from '@/lib/workshop/bigram';
import { parseWeightReport, type WeightReport } from '@/lib/workshop/weight-report';

type Model = {
  id: string;
  name: string;
  repository: string;
  parameters: string;
  storage: string;
  memory: string;
  suitability: string;
  note: string;
  level: string;
  license: string;
  architecture: string;
};

const MODELS: Model[] = [
  {
    id: 'smollm2-135m', name: 'SmolLM2 135M', repository: 'HuggingFaceTB/SmolLM2-135M-Instruct',
    parameters: '135 million', storage: '≈ 0.3 GB base weights', memory: '4 GB minimum; 8 GB RAM advised',
    suitability: 'Best first run on a CPU', note: 'Small enough to learn the workflow without waiting all day. Limited language ability.', level: 'START HERE', license: 'Apache-2.0', architecture: 'Llama',
  },
  {
    id: 'smollm2-360m', name: 'SmolLM2 360M', repository: 'HuggingFaceTB/SmolLM2-360M-Instruct',
    parameters: '360 million', storage: '≈ 0.7 GB base weights', memory: '8 GB minimum; 16 GB RAM advised',
    suitability: 'Small instruction model', note: 'Larger SmolLM2 variant; CPU training may still take a long time.', level: 'STEP UP', license: 'Apache-2.0', architecture: 'Llama',
  },
  {
    id: 'qwen2.5-0.5b', name: 'Qwen2.5 0.5B', repository: 'Qwen/Qwen2.5-0.5B-Instruct',
    parameters: '500 million', storage: '≈ 1 GB base weights', memory: '8 GB minimum; 16 GB RAM advised',
    suitability: 'Possible on a patient CPU', note: 'A more capable small model. Expect noticeably longer CPU training.', level: 'STEP UP', license: 'Apache-2.0', architecture: 'Qwen2',
  },
  {
    id: 'qwen2.5-1.5b', name: 'Qwen2.5 1.5B', repository: 'Qwen/Qwen2.5-1.5B-Instruct',
    parameters: '1.5 billion', storage: '≈ 3 GB base weights', memory: '12 GB minimum; 16+ GB and GPU advised',
    suitability: 'GPU strongly recommended', note: 'Meaningful jump in memory and time. CPU-only training can be very slow.', level: 'MORE HEADROOM', license: 'Apache-2.0', architecture: 'Qwen2',
  },
  {
    id: 'tinyllama-1.1b', name: 'TinyLlama 1.1B Chat', repository: 'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
    parameters: '1.1 billion', storage: '≈ 2.2 GB base weights', memory: '12 GB minimum; 16+ GB and GPU advised',
    suitability: 'GPU recommended', note: 'Instruction-tuned Llama architecture. CPU-only training may be very slow.', level: 'ANOTHER FAMILY', license: 'Apache-2.0', architecture: 'Llama',
  },
  {
    id: 'pythia-160m', name: 'Pythia 160M', repository: 'EleutherAI/pythia-160m',
    parameters: '160 million', storage: '≈ 0.4 GB base weights', memory: '4 GB minimum; 8 GB RAM advised',
    suitability: 'Small GPT-NeoX base model', note: 'Not instruction-tuned: chat prompts may produce completions rather than helpful answers.', level: 'BASE MODEL', license: 'Apache-2.0', architecture: 'GPT-NeoX',
  },
  {
    id: 'pythia-410m', name: 'Pythia 410M', repository: 'EleutherAI/pythia-410m',
    parameters: '410 million', storage: '≈ 0.9 GB base weights', memory: '8 GB minimum; 16 GB RAM advised',
    suitability: 'GPT-NeoX base model', note: 'Not instruction-tuned; larger than 160M and slower on a CPU.', level: 'BASE MODEL', license: 'Apache-2.0', architecture: 'GPT-NeoX',
  },
];

const number = (value: number) => value.toLocaleString('en-US');
const python = (os: 'mac' | 'windows') => os === 'mac' ? 'python3' : 'py';

function SectionHeader({ index, label, title, description }: { index: string; label: string; title: string; description: string }) {
  return <div className="mb-6 flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-start sm:justify-between sm:gap-10">
    <div className="flex min-w-0 items-start gap-4">
      <span className="mono mt-1 shrink-0 text-xs font-bold text-primary">{index}</span>
      <div><div className="eyebrow mb-1.5">{label}</div><h2 className="display text-[25px] font-bold leading-tight tracking-[-0.045em] sm:text-[31px]">{title}</h2></div>
    </div>
    <p className="max-w-[350px] text-[12px] leading-[1.75] text-muted-foreground sm:pt-5">{description}</p>
  </div>;
}

function Fact({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <div className="border-t border-border py-4 first:border-t-0">
    <div className="mb-1.5 flex items-center gap-2 text-[12px] font-bold">{icon}{title}</div>
    <p className="text-[11px] leading-[1.7] text-muted-foreground">{children}</p>
  </div>;
}

function Command({ label, command, onCopy, copied }: { label: string; command: string; onCopy: (value: string, label: string) => void; copied: boolean }) {
  return <div className="group border-b border-[#53605f]/35 py-3.5 last:border-b-0">
    <div className="mb-2 flex items-center justify-between gap-3">
      <span className="mono text-[10px] uppercase tracking-[0.15em] text-[#adc2b9]">{label}</span>
      <button type="button" data-testid={`button-copy-${label}`} onClick={() => onCopy(command, label)} className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[10px] text-[#e8eee7] transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" aria-label={`Copy ${label} command`}>
        {copied ? <Check size={12} /> : <Clipboard size={12} />}{copied ? 'Copied' : 'Copy'}
      </button>
    </div>
    <code data-testid={`text-command-${label}`} className="mono block break-all text-[11px] leading-6 text-[#f5d4ad] sm:text-[12px]"><span className="mr-2 select-none text-[#839791]">$</span>{command}</code>
  </div>;
}

export default function Workshop() {
  const [weights, setWeights] = useState<Weights>(initialWeights);
  const [steps, setSteps] = useState(0);
  const [context, setContext] = useState(0);
  const [sample, setSample] = useState('');
  const [modelId, setModelId] = useState(() => {
    try {
      const stored = localStorage.getItem('model-telemetry:workshop-model');
      return MODELS.some(model => model.id === stored) ? stored! : MODELS[0].id;
    } catch { return MODELS[0].id; }
  });
  const [os, setOs] = useState<'mac' | 'windows'>('mac');
  const [dataPath, setDataPath] = useState('');
  const [copied, setCopied] = useState('');
  const [copyError, setCopyError] = useState('');
  const [report, setReport] = useState<WeightReport | null>(null);
  const [reportError, setReportError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = MODELS.find(model => model.id === modelId) ?? MODELS[0];
  const distribution = probabilities(weights[context]);
  const currentLoss = loss(weights);
  const commands = useMemo(() => {
    const prefix = `${python(os)} private-model.py`;
    const base = `--model ${selected.id}`;
    // The path is deliberately used only to compose a local command. It is never read or saved here.
    const path = dataPath.trim() || (os === 'mac' ? '/path/to/your-data.txt' : 'C:\\path\\to\\your-data.txt');
    const safePath = os === 'windows' ? `'${path.replace(/'/g, "''")}'` : `'${path.replace(/'/g, "'\\''")}'`;
    return [
      { label: 'doctor', command: `${prefix} doctor` },
      { label: 'download', command: `${prefix} download ${base}` },
      { label: 'inspect', command: `${prefix} inspect ${base} --output weight-report.json` },
      { label: 'train', command: `${prefix} train ${base} --data ${safePath}` },
      { label: 'chat-base', command: `${prefix} chat ${base} --prompt "Introduce yourself briefly."` },
      { label: 'chat-adapter', command: `${prefix} chat ${base} --prompt "Introduce yourself briefly." --adapter` },
    ];
  }, [os, selected.id, dataPath]);

  function selectModel(id: string) {
    setModelId(id);
    try { localStorage.setItem('model-telemetry:workshop-model', id); } catch { /* Browser storage may be unavailable. */ }
  }

  async function copyCommand(value: string, label: string) {
    if (label === 'train' && !dataPath.trim()) {
      setCopyError('Enter the path to your local .txt or .jsonl file before copying the train command.');
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setCopyError('');
      window.setTimeout(() => setCopied(previous => previous === label ? '' : previous), 2200);
    } catch {
      setCopyError('Clipboard access was blocked. Select the command text above and copy it manually.');
    }
  }

  async function importReport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setReportError('');
    setReport(null);
    if (file.size > 2_000_000) {
      setReportError('Report is too large. Choose a JSON file under 2 MB.');
      return;
    }
    try {
      const parsed = parseWeightReport(JSON.parse(await file.text()) as unknown);
      setReport(parsed);
    } catch (error) {
      setReportError(error instanceof SyntaxError ? 'This file is not valid JSON. Export a weight report and try again.' : error instanceof Error ? error.message : 'Could not read this report.');
    }
  }

  function resetDemo() {
    setWeights(initialWeights());
    setSteps(0);
    setSample('');
  }

  return <main className="min-h-[100dvh] bg-background pb-20 text-foreground">
    <div className="mx-auto max-w-[1440px] px-4 sm:px-7 lg:px-10">
      <div className="flex items-center justify-between border-b border-border py-4">
        <div className="flex items-center gap-2.5"><span className="flex h-7 w-7 items-center justify-center rounded-[5px] bg-primary text-primary-foreground"><Cpu size={15} strokeWidth={2.3} /></span><span className="display text-[14px] font-bold tracking-[-0.03em]">Model Telemetry <span className="font-normal text-muted-foreground">/ Workshop</span></span></div>
        <span className="mono hidden text-[10px] uppercase tracking-widest text-muted-foreground sm:block">A field guide to local models</span>
      </div>

      <div className="grid gap-6 pb-12 pt-8 lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-10 lg:pt-11">
        <div className="relative overflow-hidden rounded-[10px] bg-[#1e3437] px-6 py-8 text-[#f7f0e3] sm:px-10 sm:py-11 lg:min-h-[330px]">
          <div className="pointer-events-none absolute -right-9 -top-16 h-72 w-72 rotate-[-22deg] rounded-full border border-[#a4bcb4]/25 sm:right-8" />
          <div className="pointer-events-none absolute -right-8 top-1 h-52 w-52 rotate-[-22deg] rounded-full border border-[#a4bcb4]/30 sm:right-18" />
          <div className="pointer-events-none absolute -right-5 top-11 h-32 w-32 rotate-[-22deg] rounded-full border border-[#a4bcb4]/35 sm:right-25" />
          <div className="pointer-events-none absolute bottom-[-32px] right-9 hidden h-28 w-28 rotate-12 grid-cols-5 gap-1 opacity-45 md:grid">{Array.from({ length: 25 }, (_, i) => <span key={i} className={`rounded-[2px] ${i % 4 === 0 ? 'bg-[#e6a27b]' : 'bg-[#718c87]'}`} />)}</div>
          <div className="relative max-w-[670px]">
            <p className="mono mb-7 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.19em] text-[#f2ab83]"><span className="h-1.5 w-1.5 rounded-full bg-[#f2ab83]" /> Guided lab · 01 / 03</p>
            <h1 className="display max-w-[630px] text-[37px] font-bold leading-[1.03] tracking-[-0.065em] sm:text-[55px] lg:text-[66px]">Make the model<br/><span className="text-[#f2ab83]">less mysterious.</span></h1>
            <p className="mt-6 max-w-[500px] text-[13px] leading-[1.8] text-[#c6d4cd]">Change a real weight. See a prediction move. Then take that understanding to an open-weight model you can run on your own computer.</p>
          </div>
        </div>
        <aside className="flex flex-col justify-between gap-6 rounded-[10px] border border-border bg-card p-5 lg:p-6">
          <div><span className="eyebrow">The lab protocol</span><div className="mt-5 space-y-0">
            {[['01', 'Touch the weights', 'A tiny in-browser bigram'], ['02', 'Choose a base', 'Seven curated open-weight options'], ['03', 'Work locally', 'Commands + evidence']].map(([n, title, sub]) => <a key={n} href={`#step-${n}`} data-testid={`link-step-${n}`} className="group flex gap-3 border-t border-border py-3.5 first:border-t-0 hover:text-primary"><span className="mono pt-0.5 text-[10px] text-primary">{n}</span><span className="flex-1"><strong className="display block text-[13px]">{title}</strong><small className="mt-1 block text-[10px] text-muted-foreground">{sub}</small></span><ArrowDownRight size={13} className="mt-1 opacity-50 transition-transform group-hover:translate-x-0.5 group-hover:translate-y-0.5" /></a>)}
          </div></div>
          <div className="rounded-md bg-accent/10 p-3.5 text-accent"><div className="flex items-center gap-2 text-[11px] font-bold"><LockKeyhole size={14} /> Privacy boundary</div><p className="mt-1.5 text-[10px] leading-[1.6]">The toy trains in this browser. Your training file stays on your computer; this page never reads or uploads it.</p></div>
        </aside>
      </div>

      <section id="step-01" className="scroll-mt-8 pb-14">
        <SectionHeader index="01" label="Hands-on experiment" title="First, change an actual weight." description="This is a seven-token bigram language model, explicitly not an LLM. It only learns which single word tends to follow another in a tiny, fixed example corpus." />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,.8fr)]">
          <div className="panel overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
              <div><div className="eyebrow mb-1">Live training bench / browser only</div><h3 className="display text-[17px] font-bold">Seven words. Forty-nine weights.</h3></div>
              <div className="flex flex-wrap gap-2">
                <button data-testid="button-train-bigram" type="button" onClick={() => { setWeights(previous => train(previous)); setSteps(previous => previous + 24); }} className="inline-flex h-9 items-center gap-2 rounded-[5px] bg-primary px-3.5 text-[11px] font-bold text-primary-foreground transition-transform hover:-translate-y-0.5"><Sparkles size={14} /> Train 24 steps</button>
                <button data-testid="button-reset-bigram" type="button" onClick={resetDemo} className="tool-button !h-9"><RotateCcw size={13} /> Reset</button>
              </div>
            </div>
            <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_190px]">
              <div className="min-w-0">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><label htmlFor="bigram-context" className="eyebrow">After this token → next token</label><select id="bigram-context" data-testid="select-bigram-context" value={context} onChange={event => setContext(Number(event.target.value))} className="mono rounded border border-border bg-background px-2 py-1.5 text-[10px] focus:outline-primary">{TOKENS.map((token, index) => <option value={index} key={token}>{token}</option>)}</select></div>
                <div className="space-y-2.5">{TOKENS.map((token, index) => <div key={token} className="grid grid-cols-[54px_minmax(0,1fr)_42px] items-center gap-2.5 sm:grid-cols-[62px_minmax(0,1fr)_48px]">
                  <span className="mono overflow-hidden text-ellipsis whitespace-nowrap text-[10px]">{token}</span>
                  <div className="h-5 overflow-hidden rounded-[3px] bg-muted"><div className="h-full rounded-[3px] bg-primary transition-[width] duration-500" style={{ width: `${distribution[index] * 100}%`, opacity: index === 0 ? .42 : .85 }} /></div>
                  <strong data-testid={`text-probability-${token.replace(/[<>]/g, '')}`} className="mono text-right text-[10px]">{(distribution[index] * 100).toFixed(1)}%</strong>
                </div>)}</div>
                <p className="mt-4 text-[10px] leading-6 text-muted-foreground">Softmax turns this row’s numeric weights into probabilities. A higher weight makes a token more likely, not guaranteed.</p>
              </div>
              <div className="flex flex-col gap-3">
                <div className="rounded-md bg-secondary/65 p-4"><span className="eyebrow">Training steps</span><strong data-testid="text-bigram-steps" className="display mt-2 block text-[27px] font-bold leading-none">{steps}</strong><span className="mono mt-3 block text-[10px] text-muted-foreground">loss <span data-testid="text-bigram-loss" className="font-bold text-foreground">{currentLoss.toFixed(3)}</span></span><p className="mt-2 text-[10px] leading-5 text-muted-foreground">Lower loss = better fit to these examples, not broader intelligence.</p></div>
                <div className="flex-1 rounded-md border border-dashed border-border p-4"><span className="eyebrow">Generate from &lt;start&gt;</span><p data-testid="text-bigram-generation" aria-live="polite" className="mt-3 min-h-[45px] text-[12px] font-medium leading-6">{sample || 'No sample yet. Generate one to see the current model speak.'}</p><button data-testid="button-generate-bigram" type="button" onClick={() => setSample(generate(weights))} className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-bold text-primary hover:underline">Generate sample <ArrowRight size={13} /></button></div>
              </div>
            </div>
            <div className="border-t border-border px-5 py-4 sm:px-6"><div className="mb-2 flex items-center justify-between"><span className="eyebrow">Raw weight matrix</span><span className="mono text-[9px] text-muted-foreground">rows = previous / columns = next</span></div>
              <div className="scrollbar-thin overflow-x-auto"><table className="mono w-full min-w-[550px] border-separate border-spacing-1 text-center text-[10px]"><thead><tr><th className="p-2 text-left text-muted-foreground">→</th>{TOKENS.map(token => <th key={token} className="p-2 font-normal text-muted-foreground">{token}</th>)}</tr></thead><tbody>{weights.map((row, rowIndex) => <tr key={TOKENS[rowIndex]}><th className={`p-2 text-left font-normal ${context === rowIndex ? 'text-primary' : 'text-muted-foreground'}`}>{TOKENS[rowIndex]}</th>{row.map((weight, colIndex) => <td key={colIndex} data-testid={`weight-${rowIndex}-${colIndex}`} className={`rounded-[3px] p-2 tabular-nums transition-colors ${context === rowIndex ? 'bg-primary/10 text-primary' : 'bg-muted/60 text-muted-foreground'}`}>{weight >= 0 ? '+' : ''}{weight.toFixed(2)}</td>)}</tr>)}</tbody></table></div>
            </div>
          </div>
          <aside className="panel flex flex-col p-5 sm:p-6"><span className="eyebrow">What just happened?</span><div className="mt-4"><Fact icon={<span className="mono text-primary">01 /</span>} title="Examples are fixed">The tiny corpus repeats phrases like “the model learns from local text.” No private data is used here.</Fact><Fact icon={<span className="mono text-primary">02 /</span>} title="An error becomes a gradient">Cross-entropy measures how surprised the model is. Gradient descent nudges all 49 weights toward less surprise.</Fact><Fact icon={<span className="mono text-primary">03 /</span>} title="A probability changes">Compare the highlighted row before and after training. These numbers are the model’s learned behavior at this scale.</Fact></div><div className="mt-auto rounded bg-muted/70 p-3.5 text-[10px] leading-[1.7] text-muted-foreground"><strong className="text-foreground">Important distinction:</strong> real LLMs have vastly more parameters, tokenization, and architectures. This toy demonstrates an optimization idea; it is not a miniature chat model.</div></aside>
        </div>
      </section>

      <section id="step-02" className="scroll-mt-8 pb-14">
        <SectionHeader index="02" label="Choose your base" title="Pick a model your machine can carry." description="These are specific trainable open-weight Hugging Face repositories, not arbitrary files. Estimates are directional; available RAM, precision, sequence length and hardware change the real requirement." />
         <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{MODELS.map((model, index) => <button key={model.id} type="button" data-testid={`button-select-${model.id}`} aria-pressed={selected.id === model.id} onClick={() => selectModel(model.id)} className={`group flex min-h-[255px] flex-col rounded-[8px] border p-5 text-left transition-all hover:-translate-y-0.5 hover:border-primary/60 sm:p-6 ${selected.id === model.id ? 'border-primary bg-primary/[.055] ring-1 ring-primary/25' : 'border-border bg-card'}`}>
          <div className="flex w-full items-start justify-between"><span className="mono text-[10px] font-bold tracking-[0.12em] text-primary">{String(index + 1).padStart(2, '0')} / {model.level}</span><span className={`flex h-5 w-5 items-center justify-center rounded-full border ${selected.id === model.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}>{selected.id === model.id && <Check size={12} />}</span></div>
           <h3 className="display mt-5 text-[22px] font-bold tracking-[-.05em]">{model.name}</h3><p className="mono mt-1 break-all text-[9px] text-muted-foreground">{model.repository}</p><p className="mono mt-2 text-[9px] text-muted-foreground">{model.architecture} · {model.license}</p>
          <div className="mt-5 grid grid-cols-2 gap-2 border-t border-border pt-4"><div><span className="eyebrow !text-[9px]">Parameters</span><strong className="mt-1 block text-[11px]">{model.parameters}</strong></div><div><span className="eyebrow !text-[9px]">Download</span><strong className="mt-1 block text-[11px]">{model.storage}</strong></div></div>
          <div className="mt-4 flex items-start gap-2 text-[11px] font-bold text-accent"><HardDrive size={14} className="mt-0.5 shrink-0" />{model.memory}</div><p className="mt-3 text-[10px] leading-[1.6] text-muted-foreground">{model.note}</p><div className="mt-auto pt-4 text-[10px] font-bold text-primary">{model.suitability} <ChevronRight size={12} className="inline" /></div>
        </button>)}</div>
         <div className="mt-3 flex items-start gap-2 rounded-md border border-border bg-secondary/45 px-4 py-3 text-[11px] leading-5 text-muted-foreground"><Info size={15} className="mt-0.5 shrink-0 text-accent" /><span><strong className="text-foreground">Selected: {selected.name} ({selected.license}).</strong> Review the <a href={`https://huggingface.co/${selected.repository}`} target="_blank" rel="noopener noreferrer" className="font-bold text-primary underline">model repository’s current license and terms</a> before downloading. Download sizes are estimates, not total install sizes. Minimum RAM is a guardrail, not a promise that training will fit; available memory, hardware, and other apps matter. Only the listed, pinned public safetensors checkpoints are supported. Gated, GGUF, custom-code and arbitrary repository IDs are not supported. Choosing a model only saves its ID in this browser.</span></div>
      </section>

      <section id="step-03" className="scroll-mt-8 pb-14">
        <SectionHeader index="03" label="Take it to your machine" title="A local workflow, in order." description="Download the companion CLI, run these commands in a terminal, and keep your dataset on your own disk. This page does not execute commands or claim that training has happened." />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(290px,.7fr)]">
          <div className="overflow-hidden rounded-[9px] bg-[#1e3437] text-[#eaf1e7]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#53605f]/45 px-5 py-4 sm:px-6"><div className="flex items-center gap-2"><Terminal size={15} className="text-[#f2ab83]" /><span className="mono text-[11px] font-bold">LOCAL TERMINAL</span></div><div className="flex rounded border border-[#6a807b] p-0.5" role="group" aria-label="Operating system"><button data-testid="button-os-mac" type="button" onClick={() => setOs('mac')} aria-pressed={os === 'mac'} className={`rounded-sm px-2.5 py-1 text-[10px] ${os === 'mac' ? 'bg-[#e7e7d8] text-[#1e3437]' : 'text-[#b8c8be]'}`}>macOS / Linux</button><button data-testid="button-os-windows" type="button" onClick={() => setOs('windows')} aria-pressed={os === 'windows'} className={`rounded-sm px-2.5 py-1 text-[10px] ${os === 'windows' ? 'bg-[#e7e7d8] text-[#1e3437]' : 'text-[#b8c8be]'}`}>Windows</button></div></div>
            <div className="px-5 pt-4 sm:px-6"><label htmlFor="workshop-data-path" className="mono mb-2 block text-[10px] uppercase tracking-[0.13em] text-[#adc2b9]">Your local training file path · optional until train</label><input id="workshop-data-path" data-testid="input-data-path" type="text" value={dataPath} onChange={event => { setDataPath(event.target.value); setCopyError(''); }} autoComplete="off" spellCheck={false} placeholder={os === 'mac' ? '/Users/you/notes/training.txt' : 'C:\\Users\\you\\notes\\training.txt'} className="mono w-full rounded border border-[#6a807b] bg-[#152a2d] px-3 py-2.5 text-[11px] text-[#f3e8d9] placeholder:text-[#889e98] focus:outline-2 focus:outline-offset-2 focus:outline-[#f2ab83]" /><p className="mt-2 text-[10px] leading-5 text-[#adc2b9]">Only inserts text into the train command. Not uploaded, read, or saved by this page.</p></div>
            <div className="px-5 pb-4 pt-2 sm:px-6">{commands.map(item => <Command key={item.label} {...item} onCopy={copyCommand} copied={copied === item.label} />)}{copyError && <p data-testid="error-copy" role="alert" className="mt-3 rounded border border-[#f2ab83]/50 p-2.5 text-[11px] text-[#ffd0b5]">{copyError}</p>}</div>
          </div>
          <aside className="panel flex flex-col p-5 sm:p-6"><span className="eyebrow">Before you begin</span><h3 className="display mt-2 text-[19px] font-bold tracking-tight">Your machine is the lab.</h3><div className="mt-4">
            <Fact icon={<Download size={14} className="text-primary" />} title="1. Get the tools"><span>Download the CLI and readme below. Python dependencies and compatible hardware are required; run doctor first.</span></Fact>
            <Fact icon={<Laptop size={14} className="text-primary" />} title="2. Fetch public weights"><span>Download connects to Hugging Face for public model weights. It is not an offline step.</span></Fact>
            <Fact icon={<LockKeyhole size={14} className="text-primary" />} title="3. Train on your own file"><span>After weights and dependencies are present, training uses your local data offline. Your computer does the compute.</span></Fact>
          </div>
            <div className="mt-auto space-y-2 border-t border-border pt-5"><a data-testid="link-download-cli" href={`${import.meta.env.BASE_URL}private-model.py`} download className="flex items-center justify-between rounded-[5px] bg-primary px-3 py-2.5 text-[11px] font-bold text-primary-foreground transition-transform hover:-translate-y-0.5"><span className="flex items-center gap-2"><Download size={14} /> Download private-model.py</span><ArrowRight size={13} /></a><a data-testid="link-download-readme" href={`${import.meta.env.BASE_URL}private-model-readme.txt`} download className="flex items-center justify-between rounded-[5px] border border-border px-3 py-2.5 text-[11px] font-bold transition-colors hover:bg-muted"><span className="flex items-center gap-2"><BookOpen size={14} /> Read the local setup guide</span><ArrowRight size={13} /></a></div>
          </aside>
        </div>
      </section>

      <section className="pb-12">
        <SectionHeader index="04" label="Evidence, not guesswork" title="Inspect the weights you actually have." description="Import a small JSON report produced on your own computer to see real tensor metadata. The report is read in this tab only; it is never sent anywhere or persisted." />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(290px,.7fr)]">
          <div className="panel min-w-0 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6"><div><span className="eyebrow">Local inspection</span><h3 className="display mt-1 text-[17px] font-bold">Weight report</h3></div><div className="flex gap-2"><input ref={fileRef} data-testid="input-weight-report" type="file" accept=".json,application/json" className="sr-only" onChange={importReport} aria-label="Choose a local weight-report JSON file" /><button data-testid="button-import-report" type="button" onClick={() => fileRef.current?.click()} className="tool-button !h-9"><Upload size={13} /> Import JSON</button>{report && <button data-testid="button-clear-report" type="button" onClick={() => { setReport(null); setReportError(''); }} className="tool-button icon !h-9 !w-9" aria-label="Clear imported report"><X size={14} /></button>}</div></div>
            {reportError && <div data-testid="error-report" role="alert" className="mx-5 mt-4 flex items-start gap-2 rounded border border-destructive/35 bg-destructive/10 p-3 text-[11px] text-destructive sm:mx-6"><CircleAlert size={15} className="shrink-0" />{reportError}</div>}
            {report ? <div data-testid="report-details">
              <div className="grid gap-4 border-b border-border p-5 sm:grid-cols-3 sm:p-6"><div><span className="eyebrow">Architecture</span><strong data-testid="text-report-architecture" className="mt-2 block break-words text-[13px]">{report.architecture}</strong></div><div><span className="eyebrow">Base parameters</span><strong data-testid="text-report-parameters" className="mono mt-2 block text-[13px]">{number(report.parameterCount)}</strong></div><div><span className="eyebrow">Tensors</span><strong data-testid="text-report-tensors" className="mono mt-2 block text-[13px]">{number(report.tensorCount)}</strong></div></div>
              <div className="px-5 py-4 sm:px-6"><p className="text-[11px] font-bold">{report.model} <span className="font-normal text-muted-foreground">· {report.repository}</span></p><p className="mono mt-1 text-[9px] text-muted-foreground">Generated {new Date(report.generatedAt).toLocaleString()}</p>{report.repository !== selected.repository && <p data-testid="warning-report-mismatch" className="mt-3 rounded bg-primary/10 p-2.5 text-[10px] text-primary">This report names a different repository than your current selection ({selected.repository}). It is shown as imported, not relabeled.</p>}</div>
              <div className="scrollbar-thin overflow-x-auto px-5 pb-4 sm:px-6"><table className="w-full min-w-[550px] text-left text-[10px]"><thead className="mono border-b border-border text-muted-foreground"><tr><th className="pb-2 pr-3 font-normal">REAL TENSOR NAME</th><th className="pb-2 pr-3 font-normal">SHAPE</th><th className="pb-2 pr-3 font-normal">DTYPE</th><th className="pb-2 pr-3 text-right font-normal">ELEMENTS</th><th className="pb-2 font-normal">ROLE</th></tr></thead><tbody>{report.tensors.map((tensor, index) => <tr data-testid={`row-tensor-${index}`} key={`${tensor.name}-${index}`} className="border-b border-border/60 last:border-b-0"><td className="mono max-w-[240px] break-all py-2.5 pr-3 font-bold">{tensor.name}</td><td className="mono py-2.5 pr-3">[{tensor.shape.join(', ')}]</td><td className="mono py-2.5 pr-3">{tensor.dtype}</td><td className="mono py-2.5 pr-3 text-right">{number(tensor.elements)}</td><td className="py-2.5">{tensor.role}</td></tr>)}</tbody></table>{report.tensors.length === 0 && <p className="py-5 text-[11px] text-muted-foreground">This report lists no individual tensors.</p>}</div>
              <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/40 px-5 py-3 text-[11px] sm:px-6"><span className="font-bold">Adapter</span><span data-testid="text-report-adapter" className="text-muted-foreground">{report.adapter ? `${number(report.adapter.parameterCount)} parameters across ${number(report.adapter.tensorCount)} tensors` : 'No adapter reported'}</span></div>
            </div> : <div data-testid="empty-report" className="flex min-h-[260px] flex-col items-center justify-center px-6 py-10 text-center"><span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted/60 text-accent"><FileJson2 size={22} /></span><h3 className="display text-[16px] font-bold">No local report imported</h3><p className="mt-2 max-w-[360px] text-[11px] leading-[1.7] text-muted-foreground">Run inspect on your computer, then import its weight-report JSON to view real names, shapes, dtypes and counts. Until then, no tensor metadata is claimed.</p></div>}
          </div>
          <aside className="panel p-5 sm:p-6"><span className="eyebrow">Reading the evidence</span><h3 className="display mt-2 text-[19px] font-bold tracking-tight">A number is not a fact.</h3><div className="mt-4"><Fact icon={<span className="mono text-primary">A /</span>} title="Weights are numeric">Tensor values are learned coefficients. Individual weights are not readable facts or sentences; behavior emerges from many weights together.</Fact><Fact icon={<span className="mono text-primary">B /</span>} title="LoRA adds, not overwrites">LoRA trains small adapter matrices. The original base weights are not rewritten; the adapter modifies the effective computation when loaded.</Fact><Fact icon={<span className="mono text-primary">C /</span>} title="File formats matter">GGUF and Ollama inference files are optimized for running models. They are not directly editable training checkpoints in this workflow.</Fact></div></aside>
        </div>
      </section>
      <footer className="flex flex-col justify-between gap-3 border-t border-border pt-5 text-[10px] leading-5 text-muted-foreground sm:flex-row"><span className="mono uppercase tracking-widest">Model Telemetry / Private Model Workshop</span><span>Learn the mechanism. Check the evidence. Keep the data local.</span></footer>
    </div>
  </main>;
}