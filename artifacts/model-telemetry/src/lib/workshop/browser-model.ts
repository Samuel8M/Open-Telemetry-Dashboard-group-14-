/**
 * A tiny, trainable next-character model for teaching what weights do.
 * It is deliberately not a downloaded or pretrained language model.
 */
export const ALPHABET = 'abcdefghijklmnopqrstuvwxyz ';
export const MAX_TEXT_LENGTH = 10_000;
export type Weights = number[][];

export type Guess = { letter: string; chance: number };
export type TrainingSummary = {
  character: string;
  before: string;
  after: string;
  beforeChance: number;
  afterChance: number;
  examples: number;
  changedWeights: number;
};

const STARTER_TEXT =
  'the small dog runs in the sun. the happy cat rests on the rug. ' +
  'the little bird sings in the tree. the model learns which letter comes next. ' +
  'the dog and the cat play in the garden.';

function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function emptyWeights(): Weights {
  return Array.from({ length: ALPHABET.length }, () => Array(ALPHABET.length).fill(0));
}

function pairCounts(text: string): { counts: number[][]; rowTotals: number[]; total: number } {
  const normalized = normalize(text);
  const counts = emptyWeights();
  const rowTotals = Array(ALPHABET.length).fill(0) as number[];
  let total = 0;
  for (let index = 0; index < normalized.length - 1; index++) {
    const source = ALPHABET.indexOf(normalized[index]);
    const target = ALPHABET.indexOf(normalized[index + 1]);
    counts[source][target] += 1;
    rowTotals[source] += 1;
    total += 1;
  }
  return { counts, rowTotals, total };
}

function probabilities(row: number[]): number[] {
  const largest = Math.max(...row);
  const exponentials = row.map(weight => Math.exp(weight - largest));
  const sum = exponentials.reduce((acc, value) => acc + value, 0);
  return exponentials.map(value => value / sum);
}

/** Full-batch gradient descent on next-character prediction. */
function learn(weights: Weights, text: string): { weights: Weights; rowTotals: number[]; total: number } {
  const { counts, rowTotals, total } = pairCounts(text);
  const next = weights.map(row => [...row]);
  for (let step = 0; step < 80; step++) {
    for (let source = 0; source < ALPHABET.length; source++) {
      if (!rowTotals[source]) continue;
      const predicted = probabilities(next[source]);
      for (let target = 0; target < ALPHABET.length; target++) {
        next[source][target] -= 0.8 * (predicted[target] - counts[source][target] / rowTotals[source]);
      }
    }
  }
  return { weights: next, rowTotals, total };
}

export function starterWeights(): Weights {
  return learn(emptyWeights(), STARTER_TEXT).weights;
}

export function guessAfter(weights: Weights, character: string): Guess[] {
  const source = ALPHABET.indexOf(character.toLowerCase());
  if (source < 0 || weights.length !== ALPHABET.length || weights[source]?.length !== ALPHABET.length) {
    throw new Error('This model cannot read that letter.');
  }
  return probabilities(weights[source])
    .map((chance, index) => ({ letter: ALPHABET[index], chance }))
    .sort((a, b) => b.chance - a.chance)
    .slice(0, 3);
}

export function teachWeights(weights: Weights, text: string): { weights: Weights; summary: TrainingSummary } {
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error('That is too much text. Try a shorter note.');
  }
  const { weights: next, rowTotals, total } = learn(weights, text);
  if (total < 1) {
    throw new Error('Type at least two English letters to teach the model.');
  }
  const source = rowTotals.findIndex((count, index) =>
    index < ALPHABET.length - 1 && count === Math.max(...rowTotals.slice(0, -1))
  );
  const character = ALPHABET[source];
  const before = guessAfter(weights, character)[0];
  const after = guessAfter(next, character)[0];
  let changedWeights = 0;
  for (let row = 0; row < ALPHABET.length; row++) {
    for (let column = 0; column < ALPHABET.length; column++) {
      if (Math.abs(next[row][column] - weights[row][column]) > 1e-9) changedWeights++;
    }
  }
  return {
    weights: next,
    summary: {
      character,
      before: before.letter,
      after: after.letter,
      beforeChance: before.chance,
      afterChance: after.chance,
      examples: total,
      changedWeights,
    },
  };
}