# AI Strategy Assistant — Architecture

Foundation for the Algotraders24 AI Strategy Assistant.
Mock-only. No external providers, no backend, no SDK.

## Folder Structure

- types/ — message, conversation, prompt, strategy, assistant
- data/ — mock-conversations, mock-prompts, mock-strategies
- services/ai/ — assistant, conversation, strategy, prompt, ai-orchestrator
- components/ai/ — ChatWindow, ChatInput, MessageBubble, ConversationSidebar, PromptSuggestions, ThinkingIndicator
- app/dashboard/assistant/ — assistant page

## Data Flow

User → Chat UI → assistant.service → ai-orchestrator.service → prompt.service + mock provider → structured response → UI

UI components never call providers directly. Every request passes
through the orchestrator.

## AI Orchestrator

Central hub. Responsibilities:
- Receive an AssistantRequest
- If a template is supplied, call the Prompt Service to build the prompt
- Call the active provider (currently mock)
- Return a formatted assistant Message

The provider is held behind the AIProvider interface, so swapping mock
for a real provider changes one object, not the UI.

## Prompt Engine

Templates use {{variable}} placeholders. prompt.service.buildPrompt
replaces variables dynamically. No prompt strings live in components —
templates sit in data/, replacement logic in the service.

## Conversation Layer

conversation.service manages threads and messages (in-memory mock).
It exposes summaries for the sidebar and full conversations on select,
plus an immutable appendMessage helper.

## Service Responsibilities

- assistant.service — UI entry point; builds user message, delegates
- ai-orchestrator.service — routing hub; prompt + provider + formatting
- prompt.service — template lookup + variable substitution
- conversation.service — thread/message state
- strategy.service — read-only strategy access

Each service has one responsibility.

## Future Provider Abstraction

Any provider (OpenAI, Claude, Gemini, DeepSeek, Ollama) implements the
AIProvider interface (name + generate). Register it in the orchestrator
in place of the mock provider. UI, types, and services stay unchanged.

## Extension Strategy

- Add async persistence behind conversation.service (types unchanged).
- Add streaming by extending the provider interface with a stream method.
- Add multi-provider selection via an orchestrator provider registry.
- Add new prompt templates in data/mock-prompts.ts — no code changes.