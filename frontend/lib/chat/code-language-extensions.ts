// lib/chat/code-language-extensions.ts
// Quant Chat "Ask AI Anything" - maps a fenced code block's language tag
// (whatever Claude puts after the opening ```) to a real file extension for
// CodeBlock's Download button. Covers the 5 target platforms this feature
// exists for (mql4/mql5/pine/cbot+cAlgo's C#/ninjascript's C#) plus common
// generic tags a model might use instead. Unknown tags fall back to .txt -
// never a guessed/wrong extension.
const EXTENSION_BY_LANGUAGE: Readonly<Record<string, string>> = {
  mql4: "mq4",
  mq4: "mq4",
  mql5: "mq5",
  mq5: "mq5",
  pine: "pine",
  pinescript: "pine",
  cbot: "cs",
  calgo: "cs",
  ninjascript: "cs",
  ninja: "cs",
  csharp: "cs",
  "c#": "cs",
  cs: "cs",
  python: "py",
  py: "py",
  javascript: "js",
  js: "js",
  typescript: "ts",
  ts: "ts",
  json: "json",
  bash: "sh",
  shell: "sh",
  sh: "sh",
};

export function extensionForLanguage(language: string): string {
  return EXTENSION_BY_LANGUAGE[language.toLowerCase()] ?? "txt";
}
