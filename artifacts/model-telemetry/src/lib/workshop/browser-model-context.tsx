import { createContext, useContext, useState, type ReactNode } from 'react';
import {
  starterWeights,
  teachWeights,
  type TrainingSummary,
  type Weights,
} from './browser-model';

type BrowserModelState = {
  weights: Weights | null;
  lastTraining: TrainingSummary | null;
  startModel: () => void;
  teachModel: (text: string) => TrainingSummary;
};

const BrowserModelContext = createContext<BrowserModelState | null>(null);

export function BrowserModelProvider({ children }: { children: ReactNode }) {
  const [weights, setWeights] = useState<Weights | null>(null);
  const [lastTraining, setLastTraining] = useState<TrainingSummary | null>(null);

  function startModel() {
    if (weights) return;
    setWeights(starterWeights());
    setLastTraining(null);
  }

  function teachModel(text: string): TrainingSummary {
    if (!weights) throw new Error('Start the model first.');
    const result = teachWeights(weights, text);
    setWeights(result.weights);
    setLastTraining(result.summary);
    return result.summary;
  }

  return (
    <BrowserModelContext.Provider value={{ weights, lastTraining, startModel, teachModel }}>
      {children}
    </BrowserModelContext.Provider>
  );
}

export function useBrowserModel(): BrowserModelState {
  const state = useContext(BrowserModelContext);
  if (!state) throw new Error('The browser model is not ready.');
  return state;
}