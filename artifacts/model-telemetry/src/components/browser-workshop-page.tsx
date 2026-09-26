import type { ReactNode } from 'react';
import { Link } from 'wouter';

type Props = {
  step: 1 | 2 | 3;
  title: string;
  description: string;
  children: ReactNode;
  back?: { href: string; label: string };
  next?: { href: string; label: string };
};

export const workshopButtonClass =
  'inline-flex min-h-16 w-full items-center justify-center rounded-xl bg-primary px-6 py-4 text-center text-lg font-bold text-primary-foreground shadow-[0_5px_0_hsl(var(--foreground)/.14)] transition-transform duration-200 hover:not-disabled:-translate-y-0.5 active:not-disabled:translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary disabled:shadow-none';

export function BrowserWorkshopPage({ step, title, description, children, back, next }: Props) {
  return (
    <main className="relative min-h-[calc(100dvh-49px)] overflow-hidden bg-background px-5 pb-10 pt-8 text-foreground sm:px-8 sm:pt-12">
      <div aria-hidden="true" className="pointer-events-none absolute -right-32 top-16 size-72 rounded-full border-[42px] border-primary/[.055] sm:-right-16 sm:size-[420px] sm:border-[60px]" />
      <div className="relative mx-auto flex min-h-[calc(100dvh-130px)] w-full max-w-[700px] flex-col">
        <div className="flex items-center justify-between gap-4 border-b border-border pb-5">
          <p className="mono text-[11px] font-bold uppercase tracking-[.17em] text-primary">Model Telemetry <span className="mx-1 text-muted-foreground">/</span> A tiny model</p>
          <p className="mono shrink-0 text-[11px] font-bold text-muted-foreground">0{step} / 03</p>
        </div>

        <div className="flex gap-1.5 pt-5" aria-label={`Step ${step} of 3`}>
          {[1, 2, 3].map(number => <span key={number} className={`h-1.5 flex-1 rounded-full ${number <= step ? 'bg-primary' : 'bg-border'}`} />)}
        </div>

        <header className="mt-10 sm:mt-16">
          <p className="mono text-xs font-bold uppercase tracking-[.19em] text-accent">Step {step} of 3</p>
          <h1 className="display mt-4 max-w-[620px] text-[clamp(2.7rem,8vw,5.1rem)] font-bold leading-[1.02] tracking-[-.065em]">{title}</h1>
          <p className="mt-6 max-w-[540px] text-lg leading-[1.6] text-muted-foreground sm:text-xl">{description}</p>
        </header>

        <div className="mt-9 w-full max-w-[560px] sm:mt-12">{children}</div>

        <div className="mt-auto pt-14">
          {(back || next) && (
            <nav aria-label="Workshop steps" className="flex items-center justify-between gap-5 border-t border-border pt-5 text-sm font-bold">
              {back ? <Link href={back.href} data-testid="link-back" className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">← {back.label}</Link> : <span />}
              {next && <Link href={next.href} data-testid="link-next" className="text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary">{next.label} →</Link>}
            </nav>
          )}
          <p className="mt-7 max-w-[560px] text-xs leading-5 text-muted-foreground">
            Your text is processed in this tab only. It is not uploaded. The model’s trained numbers reset when you refresh.
          </p>
        </div>
      </div>
    </main>
  );
}