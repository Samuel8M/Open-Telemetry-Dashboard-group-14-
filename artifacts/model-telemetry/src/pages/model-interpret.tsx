import { useState } from 'react';
import { Link } from 'wouter';
import { BrowserWorkshopPage, workshopButtonClass } from '@/components/browser-workshop-page';
import { guessAfter } from '@/lib/workshop/browser-model';
import { useBrowserModel } from '@/lib/workshop/browser-model-context';

export default function ModelInterpret() {
  const { weights } = useBrowserModel();
  const [revealed, setRevealed] = useState(false);
  const guesses = weights && revealed ? guessAfter(weights, 't') : [];
  const best = guesses[0];

  return (
    <BrowserWorkshopPage
      step={2}
      title="What did it learn?"
      description="The model keeps little numbers called weights. Those numbers help it guess the next letter."
      back={{ href: '/', label: 'Start' }}
      next={{ href: '/adjust', label: 'Teach it' }}
    >
      <div className="mb-7 flex items-center gap-4 rounded-2xl border border-border bg-card p-5 sm:p-7">
        <span className="display flex size-14 shrink-0 items-center justify-center rounded-xl bg-secondary text-4xl font-bold">t</span>
        <span className="mono text-2xl text-primary">→</span>
        <span className="display flex size-14 shrink-0 items-center justify-center rounded-xl border border-dashed border-primary/50 text-4xl font-bold text-primary">{best?.letter ?? '?'}</span>
        <span className="ml-auto text-right text-sm leading-5 text-muted-foreground">One letter<br />at a time</span>
      </div>

      <button type="button" data-testid="button-show-learning" disabled={!weights} onClick={() => setRevealed(true)} className={workshopButtonClass}>
        Show what it learned
      </button>

      {!weights && <p className="mt-5 text-sm leading-6 text-muted-foreground">First, <Link href="/" data-testid="link-start-model" className="font-bold text-primary underline underline-offset-4">start the model</Link> in your browser.</p>}
      {revealed && best && (
        <section aria-live="polite" data-testid="result-learned-guess" className="mt-7 rounded-2xl border border-primary/25 bg-primary/[.07] p-5 sm:p-7">
          <p className="mono text-[11px] font-bold uppercase tracking-[.16em] text-primary">Its best guess</p>
          <p className="display mt-3 text-[clamp(1.6rem,5vw,2.5rem)] font-bold leading-tight tracking-[-.04em]">
            After “t”, it guesses “{best.letter}”.
          </p>
          <p className="mt-3 text-base leading-7 text-muted-foreground">It gives that guess a {Math.round(best.chance * 100)}% chance. A weight is a number that helps make this guess, not a word stored inside the model.</p>
        </section>
      )}
    </BrowserWorkshopPage>
  );
}