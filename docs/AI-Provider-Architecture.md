# AI Provider Abstraction Layer

Lets future AI models connect without touching UI, pages, or services.
Architecture only — no SDKs, no API keys.

## Flow

UI → assistant.service → ai-orchestrator → provider-factory → registry → selected provider → ProviderResponse

The orchestrator never instantiates providers. It asks the factory.

## Provider Interface

`types/provider.ts` — every provider implements:
- generate(prompt)
- chat(messages)
- summarize(text)
- analyze(input)
- healthCheck()
- stream(prompt) — async generator (placeholder for now)

All methods return a typed `ProviderResponse` (provider, content, implemented).

## Provider Registry

`providers/provider-registry.ts` maps ProviderName → implementation:

    mock      → mockProvider
    openai    → openaiProvider
    claude    → claudeProvider
    gemini    → geminiProvider
    deepseek  → deepseekProvider
    ollama    → ollamaProvider

One object. Adding a provider = one line here.

## Provider Factory

`providers/provider-factory.ts`:
- getProvider(name) returns the instance
- throws UnknownProviderError for unknown names
- defaults to "mock"

No switch statements anywhere.

## Orchestrator Integration

    orchestrate(req, providerName = "mock")
      → build prompt (if template)
      → getProvider(providerName)
      → provider.generate(prompt)
      → format Message

Switching provider = pass a different name. No UI change.

## Adding a New Provider

1. Create `providers/xyz-provider.ts` implementing AIProvider.
2. Add its name to `types/provider-name.ts`.
3. Register it in `provider-registry.ts`.

Done. Components, pages, and services stay untouched.

## Future SDK Integration

Replace a placeholder's method bodies with real SDK calls inside that
one provider file. The interface and everything above it stay stable.

## Streaming Support

`stream()` is an async generator returning a placeholder chunk today.
Real streaming = yield tokens as the SDK emits them. Orchestrator can
later expose a streaming path without interface changes.

## Error Handling

- Unknown provider → UnknownProviderError (typed).
- Unimplemented placeholders return implemented: false + a clear message.
- healthCheck() reports readiness per provider without throwing.