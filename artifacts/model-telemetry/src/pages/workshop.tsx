import { CopyCommand, FlowPage, MODELS, useSelectedModel, type ModelId } from '@/components/workshop-flow';

export default function Workshop() {
  const { modelId, selectModel } = useSelectedModel();
  const command = `python private-model.py download --model ${modelId}`;

  return <FlowPage step={1} title="Download weights." description="Weights are the numbers a model has learned. Pick a model, then get its weights on your computer." next="/interpret">
    <label htmlFor="model-choice" className="mb-3 block text-base font-bold">Choose a model</label>
    <select id="model-choice" data-testid="select-model" value={modelId} onChange={event => selectModel(event.target.value as ModelId)} className="min-h-14 w-full rounded-xl border border-border bg-card px-4 text-lg text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
      {MODELS.map(model => <option key={model.id} value={model.id}>{model.name}{model.id === 'smollm2-135m' ? ' — start here' : ''}</option>)}
    </select>
    <div className="mt-8">
      <CopyCommand command={command} action="Copy download command" testId="button-copy-download" />
    </div>
    <p className="mt-7 text-center text-base leading-7 text-muted-foreground">This page only copies a command. After setting up Python, run it in the helper’s folder to download the weights.</p>
    <p className="mt-5 text-center text-sm leading-7">
      First get <a href={`${import.meta.env.BASE_URL}private-model.py`} download data-testid="link-download-cli" className="font-bold text-primary underline underline-offset-4">private-model.py</a> and follow the <a href={`${import.meta.env.BASE_URL}private-model-readme.txt`} target="_blank" rel="noreferrer" data-testid="link-download-readme" className="font-bold text-primary underline underline-offset-4">setup guide</a>.
    </p>
  </FlowPage>;
}