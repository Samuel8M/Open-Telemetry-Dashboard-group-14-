import { useState } from 'react';
import { CopyCommand, FlowPage, useSelectedModel } from '@/components/workshop-flow';

export default function ModelAdjust() {
  const { modelId } = useSelectedModel();
  const [filename, setFilename] = useState('my-notes.txt');
  const valid = /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(txt|jsonl)$/i.test(filename);
  const command = `python private-model.py train --model ${modelId} --data ${valid ? filename : 'my-notes.txt'}`;

  return <FlowPage step={3} title="Adjust with your text." description="Put your own text file next to the helper. Then copy a command to train the model on your computer." back="/interpret">
    <label htmlFor="local-filename" className="mb-3 block text-base font-bold">What is your file called?</label>
    <input id="local-filename" data-testid="input-data-path" type="text" autoComplete="off" spellCheck={false} value={filename} onChange={event => setFilename(event.target.value)} placeholder="my-notes.txt" className="min-h-14 w-full rounded-xl border border-border bg-card px-4 text-lg text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
    {!valid && <p data-testid="error-data-path" role="alert" className="mt-2 text-sm text-destructive">Use a simple name ending in .txt or .jsonl. No spaces or folders.</p>}
    <div className="mt-8">
      {valid ? <CopyCommand command={command} action="Copy training command" testId="button-copy-train" /> : <div className="text-center">
        <button type="button" data-testid="button-copy-train" disabled className="inline-flex min-h-16 w-full items-center justify-center rounded-xl bg-primary px-6 text-lg font-bold text-primary-foreground">Copy training command</button>
        <p data-testid="hint-train-disabled" className="mt-4 text-sm text-muted-foreground">Fix the file name to copy your command.</p>
      </div>}
    </div>
    <p className="mt-7 text-center text-base leading-7 text-muted-foreground">This page never reads or saves your file. The command makes a small add-on; your original model stays the same. Turn off Wi-Fi while it runs for extra privacy.</p>
    <p className="mt-5 text-center text-sm leading-7 text-muted-foreground">Set up the helper and download the model first. <a href={`${import.meta.env.BASE_URL}private-model-readme.txt`} target="_blank" rel="noreferrer" data-testid="link-setup-guide" className="font-bold text-primary underline underline-offset-4">Read the setup guide</a>.</p>
  </FlowPage>;
}