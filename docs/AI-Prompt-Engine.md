# AI Prompt Intelligence Engine

Turns raw user input into an engineered prompt: intent -> persona -> template -> schema -> system prompt -> Gemini.

## Prompt Lifecycle

User input -> Intent Classifier -> Prompt Router -> (Persona + Template + Schema) -> System Prompt Builder -> Gemini Provider -> response.

## Intent Classification

`intent-classifier.service.ts` keyword-matches input into one intent:
market-analysis, news-analysis, strategy-generation, ea-generation,
risk-analysis, portfolio-analysis, trading-education, trading-psychology,
general-chat. No API cost.

## Persona Selection

`prompt-router.service.ts` maps each intent to a persona
(`persona.service.ts`): e.g. market-analysis -> Trading Analyst,
ea-generation -> MQL5 Developer, news -> News Analyst.

## Prompt Routing

Each intent also maps to a template (`prompt-library.service.ts`) and an
output schema (`response-schema.service.ts`). One route = persona +
template + schema.

## Response Formatting

`response-schema.service.ts` defines section lists per output type
(Market Analysis, Strategy, EA, General). The system prompt asks Gemini
to structure the answer using those sections.

## System Prompt

`system-prompt.service.ts` assembles: search hint + persona role + task
+ schema sections + platform rules + user input. Built in the assistant
service and passed through the existing orchestrator/provider layer -
no changes to Conversation Manager, Repository, or Provider Factory.

## Platform Rules

Professional, no hallucination, never guarantee profit, explain
reasoning, mention risk, markdown, structured.

## Future AI Agents

Each persona can later become an autonomous agent with its own tools
(market data, code execution). The router already selects the persona;
agents plug in behind the same interface. Providers (OpenAI, Claude,
DeepSeek, Ollama) work unchanged since the engine sits above the provider layer.