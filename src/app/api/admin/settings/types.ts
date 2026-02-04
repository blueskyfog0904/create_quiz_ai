export interface DifficultyLevel {
  id: string;
  name: string;
  promptValue: string;
}

export interface AIConfig {
  // Legacy field support
  difficulty?: {
    high: string;
    middle: string;
  };
  // New dynamic structure
  difficultyLevels: DifficultyLevel[];
  counts: number[];
}

export interface SystemSetting {
  key: string;
  value: AIConfig;
  description: string;
  updated_at: string;
}

export interface AIModelConfig {
  modelName: string;
}

export interface AIModelOption {
  id: string;
  name: string;
  description: string;
  warning?: string;
  badge?: string;
}

export const DEFAULT_MODELS: AIModelOption[] = [
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    description: 'Latest fast model, high performance and good quota compatibility.',
    badge: 'Recommended'
  },
  {
    id: 'gemini-1.5-flash',
    name: 'Gemini 1.5 Flash',
    description: 'Previous generation fast model. Standard quota.',
  },
  {
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    description: 'Higher reasoning capability, but slower and lower free quota.',
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    description: 'New experimental model.',
    warning: 'Warning: Extremely low free tier quota (20 req/day). Use with caution.'
  }
];
