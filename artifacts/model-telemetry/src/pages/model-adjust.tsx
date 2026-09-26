import { useState } from 'react';
import { Link } from 'wouter';
import { BrowserWorkshopPage, workshopButtonClass } from '@/components/browser-workshop-page';
import { MAX_TEXT_LENGTH } from '@/lib/workshop/browser-model';
import { useBrowserModel } from '@/lib/workshop/browser-model-context';

export default function ModelAdjust() {
  const { weights, teachModel, lastTraining } = useBrowserModel();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ReturnType<typeof teachModel> | null>(null);
  const training = result ?? lastTraining;

  function teach() {
    if (!text.trim()) {
      setError('Type a little text first.');
      return;
    }
    try {
      const summary = teachModel(text);
      setResult(summary);
      setText('');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That did not work. Try a little more text.');
    }
  }

  return (
    <BrowserWorkshopPage
      step={3}
      title="Teach it your way."
      description="Type a sentence or paste your own text. The model will practice guessing the next letter."
      back={{ href: '/interpret', label: 'What it learned' }}
    >
      <label htmlFor="training-text" className="mb-3 block text-sm font-bold text-foreground">Your text</label>
      <textarea
        id="training-text"
        data-testid="input-training-text"
        value={text}
        onChange={event => {
          const next = event.target.value;
          if (next.length > MAX_TEXT_LENGTH) {
            setError('That is too much text. Try a shorter note.');
            return;
          }
          setText(next);
          if (error) setError('');
        }}
        placeholder="The tiny turtle took a trip..."
        rows={5}
        className="block w-full resize-y rounded-xl border border-border bg-card px-4 py-4 text-base leading-7 text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      />
      <p className="mt-2 text-right text-xs text-muted-foreground" data-testid="text-character-count">{text.length} / {MAX_TEXT_LENGTH} characters</p>
      <button type="button" data-testid="button-teach-model" disabled={!weights} onClick={teach} className={`mt-5 ${workshopButtonClass}`}>
        Teach with my text
      </button>
      {!weights && <p className="mt-4 text-sm leading-6 text-muted-foreground">First, <Link href="/" data-testid="link-start-model" className="font-bold text-primary underline underline-offset-4">start the model</Link> in your browser.</p>}
      {error && <p role="alert" data-testid="error-training" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</p>}
      {training && (
        <section aria-live="polite" data-testid="result-training" className="mt-7 rounded-2xl border border-primary/25 bg-primary/[.07] p-5 sm:p-7">
          <p className="mono text-[11px] font-bold uppercase tracking-[.16em] text-primary">It learned from your text</p>
          <p className="display mt-3 text-xl font-bold leading-snug tracking-[-.035em] sm:text-2xl">
            After “{training.character}”, it now guesses “{training.after}”.
          </p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Before: “{training.before}” ({Math.round(training.beforeChance * 100)}% chance). Now: “{training.after}” ({Math.round(training.afterChance * 100)}% chance).
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">It practiced with {training.examples} letter pairs and changed {training.changedWeights} weights. You can teach it again.</p>
        </section>
      )}
    </BrowserWorkshopPage>
  );
}