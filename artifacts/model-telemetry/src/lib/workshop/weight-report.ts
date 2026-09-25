export type WeightReport = {
  format: 'private-model-weight-report';
  version: 1;
  model: string;
  repository: string;
  generatedAt: string;
  architecture: string;
  parameterCount: number;
  tensorCount: number;
  tensors: { name: string; shape: number[]; dtype: string; elements: number; role: string }[];
  adapter: { parameterCount: number; tensorCount: number } | null;
};

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 1000;
}

export function parseWeightReport(input: unknown): WeightReport {
  if (!record(input) || !exactKeys(input, ['format', 'version', 'model', 'repository', 'generatedAt', 'architecture', 'parameterCount', 'tensorCount', 'tensors', 'adapter'])) {
    throw new Error('This is not a complete private-model weight report. Check the file format and required fields.');
  }
  if (input.format !== 'private-model-weight-report' || input.version !== 1) {
    throw new Error('Unsupported report format or version. Expected private-model-weight-report, version 1.');
  }
  if (![input.model, input.repository, input.generatedAt, input.architecture].every(nonempty)
    || Number.isNaN(Date.parse(input.generatedAt as string))) {
    throw new Error('Model, repository, architecture and a valid generatedAt date are required.');
  }
  if (!count(input.parameterCount) || !count(input.tensorCount) || !Array.isArray(input.tensors) || input.tensors.length > 12) {
    throw new Error('Parameter and tensor counts must be non-negative integers; tensors must be an array (at most 12 examples).');
  }
  if (input.tensorCount < input.tensors.length) {
    throw new Error('Tensor count cannot be smaller than the number of listed tensors.');
  }
  for (const tensor of input.tensors) {
    if (!record(tensor) || !exactKeys(tensor, ['name', 'shape', 'dtype', 'elements', 'role'])
      || !nonempty(tensor.name) || !nonempty(tensor.dtype) || !nonempty(tensor.role)
      || !Array.isArray(tensor.shape) || tensor.shape.length > 8
      || !tensor.shape.every(dimension => count(dimension) && dimension > 0)
      || !count(tensor.elements)
      || tensor.shape.reduce<number>((product, dimension: number) => product * dimension, 1) !== tensor.elements) {
      throw new Error('A tensor has invalid name, shape, dtype, element count or role.');
    }
  }
  if (input.adapter !== null && (!record(input.adapter)
    || !exactKeys(input.adapter, ['parameterCount', 'tensorCount'])
    || !count(input.adapter.parameterCount) || !count(input.adapter.tensorCount))) {
    throw new Error('Adapter must be null or contain integer parameterCount and tensorCount.');
  }
  return input as WeightReport;
}