# Gemini 2.5 Integration

Real AI provider for the Algotraders24 assistant. Replaces the mock provider with Google Gemini 2.5 Flash.

## Architecture

UI -> Assistant Service -> Orchestrator -> Provider Factory -> Gemini Provider -> /api/ai (server) -> Google Gen AI SDK

The provider never calls the SDK from the browser. It calls an internal server route (/api/ai) which holds the API key. This keeps the key off the client.

## SDK

Official: `@google/genai` (GA). The legacy `@google/generative-ai` is deprecated and not used.

Install:
    npm install @google/genai

Usage (server route only):
    import { GoogleGenAI } from "@google/genai";
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({ model, contents: prompt });

## Environment Variables

.env.local (local) and Vercel Environment Variables (production):

    GEMINI_API_KEY=your-key
    DEFAULT_AI_PROVIDER=gemini
    DEFAULT_AI_MODEL=gemini-2.5-flash

Never hardcode the key. .env.local is gitignored. Vercel needs the same three variables added under Settings -> Environment Variables, then a redeploy.

## Configuration

config/ai.config.ts holds defaults: provider, model, temperature, maxTokens, timeout, retryCount. Reads model/provider from env with fallbacks.

## How to Obtain an API Key

1. Go to https://aistudio.google.com/apikey
2. Sign in with a Google account (no credit card).
3. Create API key, copy it.
4. Paste into GEMINI_API_KEY.

Free tier: Gemini 2.5 Flash, ~1,500 requests/day, 15 RPM. Free-tier prompts may be used by Google for training, so avoid sensitive data until on a paid tier.

## Error Handling

services/ai/providers/provider-errors.ts classifies errors into typed kinds: invalid-key, rate-limit, timeout, network, invalid-response, unknown. The server route catches SDK errors and returns a typed response; raw SDK errors never reach the UI.

## Streaming

The provider's stream() is a placeholder that yields the full response once. The app has no streaming path yet. To enable real streaming later, switch the route to generateContentStream and yield chunks.

## Future Model Upgrades

Change DEFAULT_AI_MODEL (env) to move models (e.g. a newer Flash). No code change needed. To add other providers (OpenAI, Claude, DeepSeek, Ollama), implement their provider file and register it — the UI, services, and orchestrator stay unchanged.