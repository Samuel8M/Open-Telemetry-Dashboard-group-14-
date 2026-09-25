export const TOKENS = ['<start>', 'the', 'model', 'learns', 'from', 'local', 'text'] as const;
export type Weights = number[][];

const SENTENCES = [
  ['the', 'model', 'learns', 'from', 'local', 'text'],
  ['the', 'model', 'learns', 'from', 'text'],
  ['local', 'text', 'learns', 'from', 'the', 'model'],
  ['the', 'model', 'learns', 'from', 'local', 'text'],
];

const pairs: [number, number][] = SENTENCES.flatMap(sentence => {
  const sequence = ['<start>', ...sentence, '<start>'];
  return sequence.slice(0, -1).map((token, index) => [
    TOKENS.indexOf(token as typeof TOKENS[number]),
    TOKENS.indexOf(sequence[index + 1] as typeof TOKENS[number]),
  ] as [number, number]);
});

export function initialWeights(): Weights {
  return TOKENS.map(() => TOKENS.map(() => 0));
}

export function probabilities(row: number[]): number[] {
  const max = Math.max(...row);
  const exps = row.map(value => Math.exp(value - max));
  const total = exps.reduce((sum, value) => sum + value, 0);
  return exps.map(value => value / total);
}

export function loss(weights: Weights): number {
  return pairs.reduce((sum, [source, target]) => sum - Math.log(Math.max(probabilities(weights[source])[target], 1e-12)), 0) / pairs.length;
}

/** Full-batch cross-entropy gradient descent; all examples and parameters stay in this tab. */
export function train(weights: Weights, iterations = 24): Weights {
  let current = weights.map(row => [...row]);
  for (let step = 0; step < iterations; step++) {
    const gradient = initialWeights();
    for (const [source, target] of pairs) {
      const predicted = probabilities(current[source]);
      for (let column = 0; column < TOKENS.length; column++) {
        gradient[source][column] += predicted[column] - Number(column === target);
      }
    }
    current = current.map((row, source) => row.map((value, column) =>
      value - (2.4 / pairs.length) * gradient[source][column],
    ));
  }
  return current;
}

export function generate(weights: Weights, maxWords = 11): string {
  const words: string[] = [];
  let source = 0;
  for (let i = 0; i < maxWords; i++) {
    const distribution = probabilities(weights[source]);
    let draw = Math.random();
    let next = distribution.length - 1;
    for (let j = 0; j < distribution.length; j++) {
      draw -= distribution[j];
      if (draw <= 0) { next = j; break; }
    }
    if (next === 0) {
      if (words.length) break;
      continue;
    }
    words.push(TOKENS[next]);
    source = next;
  }
  return words.length ? words.join(' ') : '(end of sequence)';
}