import { useState } from 'react';
import { useLocation } from 'wouter';
import { BrowserWorkshopPage, workshopButtonClass } from '@/components/browser-workshop-page';
import { useBrowserModel } from '@/lib/workshop/browser-model-context';

export default function BrowserWorkshop() {
  const { startModel } = useBrowserModel();
  const [, setLocation] = useLocation();
  const [error, setError] = useState('');

  function start() {
    try {
      startModel();
      setLocation('/interpret');
    } catch {
      setError('The model could not start. Please try again.');
    }
  }

  return (
    <BrowserWorkshopPage
      step={1}
      title="Meet a tiny model."
      description="It starts with a few example sentences and guesses which English letter might come next. You can teach it here."
    >
      <div aria-hidden="true" className="mb-7 flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-5 sm:px-7">
        <span className="mono text-sm text-muted-foreground">after</span>
        <span className="display flex size-12 items-center justify-center rounded-lg bg-secondary text-3xl font-bold text-foreground">t</span>
        <span className="mono text-xl text-primary">→</span>
        <span className="display flex size-12 items-center justify-center rounded-lg bg-primary text-3xl font-bold text-primary-foreground">?</span>
        <span className="ml-auto hidden text-sm text-muted-foreground sm:block">A guess, not a word.</span>
      </div>
      <button type="button" data-testid="button-start-model" onClick={start} className={workshopButtonClass}>
        Start in my browser
      </button>
      {error && <p role="alert" data-testid="error-start-model" className="mt-4 text-sm text-destructive">{error}</p>}
      <p className="mt-5 text-sm leading-6 text-muted-foreground">
        This is a small, trainable next-letter model, <strong className="font-semibold text-foreground">not a large pretrained LLM</strong>.
      </p>
    </BrowserWorkshopPage>
  );
}