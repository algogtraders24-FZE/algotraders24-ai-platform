// types/prompt.ts
export interface PromptVariables {
  [key: string]: string;
}

export interface PromptTemplate {
  id: string;
  label: string;
  template: string; // e.g. "Analyze {{symbol}}"
  variables: string[]; // ["symbol", "timeframe"]
}

export interface PromptSuggestion {
  id: string;
  label: string;
  prompt: string;
}