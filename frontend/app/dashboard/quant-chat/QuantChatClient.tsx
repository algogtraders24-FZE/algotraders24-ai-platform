"use client";

// app/dashboard/quant-chat/QuantChatClient.tsx
// QP-2 - Conversational Strategy Builder's dedicated route. Reuses the
// existing components/ai/* chat shell (ChatWindow/ChatInput/
// ThinkingIndicator/PromptSuggestions) - the same additive-prop
// extensions ChatWindow/PromptSuggestions/MessageBubble gained for this
// sprint keep every existing K-series caller unaffected. Deliberately
// does NOT reuse ConversationSidebar: that component's rename/pin/
// archive/delete affordances assume a persisted, multi-conversation
// store (StoredConversation), which QP-2's locked in-memory-only-for-v1
// decision doesn't have - a single active conversation, lost on refresh,
// exactly as that decision states.
//
// Quant Pro production launch - this file is the QP-2/3/4/5 UI. It moved
// from page.tsx into this plain client component because the route needs
// a server-side entitlement gate in front of it (page.tsx checks
// hasQuantProAccess() and renders either this component or
// QuantProUpgradeGate) - client components can't perform that DB check
// themselves.
//
// Owner decision (2026-09-23) - simplification to a single mode.
// QP-2's original three-tab design (Modify strategy / Explain this
// strategy / Ask AI Anything) tested confusing in practice: "Explain"
// silently did nothing but paraphrase an already-compiled spec despite
// its name suggesting general Q&A, and Modify's own deterministic
// compile->backtest pipeline lived in a separate mode from the general
// chat/codegen flow users actually wanted (describe or upload a
// strategy, get real platform code). The owner's explicit call: drop
// Modify/Explain and the backtest/preview UI they powered, keep ONLY
// "Ask AI Anything" - a single, general-purpose LLM surface. This is a
// deliberate narrowing, not a regression: the deterministic
// compile/validate/backtest pipeline (nl-strategy-compiler.service.ts,
// /api/private/algo-test/{compile,strategy-builder,ai-runs}, Strategy
// Library, Run History) is UNTOUCHED and still reachable via those other
// routes/pages - only THIS page's UI no longer surfaces it. Revisit if
// the product direction changes; nothing here is a one-way door for the
// underlying engine.
import { useRef, useState } from "react";
import ChatWindow from "@/components/ai/ChatWindow";
import ChatInput from "@/components/ai/ChatInput";
import PromptSuggestions from "@/components/ai/PromptSuggestions";
import type { DisplayMessage } from "@/components/ai/MessageBubble";
import { quantChatPromptSuggestions } from "@/data/quant-chat-prompts";
import { sendMessageStreaming } from "@/services/ai/assistant.service";
import type { AIImageInput } from "@/lib/ai/types";
import Button from "@/components/ui/Button";

function newId(): string {
  return `qc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Image attachments. Mirrors the route's own limits
// (app/api/private/knowledge/chat/route.ts) exactly - rejecting a
// too-large/unsupported image HERE, before ever reading it, is strictly
// better UX than a round-trip 400, and the server-side check stays the
// real boundary regardless (never trust the client alone).
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 1_500_000; // ~1.5MB raw

// One-click code generation for the strategy on hand. Deliberately NOT a
// deterministic IR->template compiler per platform (that's Quant Lite's
// own, separate, much narrower approach at app/api/quant-lite/codegen/
// route.ts, limited to mql4/mql5/pine) - this asks Claude directly to
// WRITE the target platform's real code, grounded on this conversation's
// own history (askServerConversationIdRef's continuity is what makes
// "the strategy we've just been discussing" resolve correctly).
// Never claims backtest-verified correctness the way the engine's
// compiled/reduced StrategySpec path does - this is a code-authoring aid,
// always reviewed by the trader before use on a live account.
const CODEGEN_TARGETS: ReadonlyArray<{ label: string; instruction: string }> = [
  { label: "MT4", instruction: "Write the complete MetaTrader 4 (MQL4) Expert Advisor code for the strategy we've just been discussing. Return it as a single ```mql4 fenced code block, ready to compile in MetaEditor." },
  { label: "MT5", instruction: "Write the complete MetaTrader 5 (MQL5) Expert Advisor code for the strategy we've just been discussing. Return it as a single ```mql5 fenced code block, ready to compile in MetaEditor." },
  { label: "Pine Script", instruction: "Write the complete TradingView Pine Script (v5) strategy code for the strategy we've just been discussing. Return it as a single ```pine fenced code block." },
  { label: "cBot", instruction: "Write the complete cTrader cBot (C#/cAlgo API) code for the strategy we've just been discussing. Return it as a single ```cbot fenced code block." },
  { label: "NinjaScript", instruction: "Write the complete NinjaTrader 8 NinjaScript (C#) strategy code for the strategy we've just been discussing. Return it as a single ```ninjascript fenced code block." },
];

export default function QuantChatClient() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingDraft, setStreamingDraft] = useState<DisplayMessage | null>(null);
  const draftRef = useRef<string>("");
  const abortRef = useRef<AbortController | null>(null);
  // Real multi-turn continuity - the FIRST turn sends no
  // serverConversationId (the route creates one and returns it in the
  // "done" event, exactly like the dashboard Assistant page's own first
  // turn); every turn after that echoes it back so the server actually
  // has history to answer a follow-up like "now write the MT5 code for
  // that" against.
  const serverConversationIdRef = useRef<string | undefined>(undefined);
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string } | null>(null);
  // Mutually exclusive with attachedFile - attaching one clears the other
  // (a single attachment slot, matching ChatInput's single-chip UI).
  // `previewUrl` is a data: URL (readAsDataURL) - reused directly as both
  // the base64 payload sent to Claude (prefix stripped) and the <img> src
  // shown in ChatInput/MessageBubble, no separate object-URL lifecycle to manage.
  const [attachedImage, setAttachedImage] = useState<{ name: string; mediaType: string; base64: string; previewUrl: string } | null>(null);

  function pushMessage(msg: DisplayMessage) {
    setMessages((prev) => [...prev, msg]);
  }

  function handleAttachFile(file: File) {
    if (file.type.startsWith("image/")) {
      if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        setError(`Unsupported image type "${file.type}" - use PNG, JPEG, WEBP, or GIF.`);
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setError(`"${file.name}" is too large (max ~1.5MB) - try a smaller image or a screenshot crop.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : "";
        const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
        setAttachedFile(null);
        setAttachedImage({ name: file.name, mediaType: file.type, base64, previewUrl: dataUrl });
      };
      reader.onerror = () => setError(`Could not read "${file.name}".`);
      reader.readAsDataURL(file);
      return;
    }

    setAttachedImage(null);
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === "string" ? reader.result : "";
      setAttachedFile({ name: file.name, content });
    };
    reader.onerror = () => setError(`Could not read "${file.name}" - try a plain text file.`);
    reader.readAsText(file);
  }

  async function handleSend(rawText: string) {
    setError(null);
    // A file attaches as extra context, never silently replacing what the
    // user actually typed - both are shown so the sent turn is never a
    // surprise relative to what appeared in the input.
    const text = attachedFile ? `Attached file "${attachedFile.name}":\n\`\`\`\n${attachedFile.content}\n\`\`\`\n\n${rawText}`.trim() : rawText;
    const image = attachedImage;
    setAttachedFile(null);
    setAttachedImage(null);
    const now = new Date().toISOString();
    pushMessage({ id: newId(), role: "user", content: text, createdAt: now, attachedImageUrl: image?.previewUrl });

    setThinking(true);
    draftRef.current = "";
    const draftId = newId();
    const draftCreatedAt = new Date().toISOString();
    setStreamingDraft({ id: draftId, role: "assistant", content: "", createdAt: draftCreatedAt });
    const controller = new AbortController();
    abortRef.current = controller;
    const images: AIImageInput[] | undefined = image ? [{ mediaType: image.mediaType, base64: image.base64 }] : undefined;
    try {
      const result = await sendMessageStreaming(
        { conversationId: `quant-chat-${draftId}`, message: text, serverConversationId: serverConversationIdRef.current, images },
        (chunk) => {
          setThinking(false);
          draftRef.current += chunk;
          setStreamingDraft((d) => (d ? { ...d, content: draftRef.current } : d));
        },
        controller.signal,
      );
      if (result.kind === "chat" && result.serverConversationId) serverConversationIdRef.current = result.serverConversationId;
      pushMessage(
        result.kind === "market-analysis"
          ? { id: draftId, role: "assistant", content: result.result.summary, createdAt: draftCreatedAt, marketAnalysis: result.result }
          : { id: draftId, role: "assistant", content: result.fullText, createdAt: draftCreatedAt, sources: result.sources, intelligence: result.intelligence },
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        if (draftRef.current.trim().length > 0) {
          pushMessage({ id: draftId, role: "assistant", content: draftRef.current, createdAt: draftCreatedAt });
        }
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong answering this question.");
      }
    } finally {
      setThinking(false);
      setStreamingDraft(null);
      abortRef.current = null;
    }
  }

  return (
    <div className="flex h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-ink text-text">
      <header className="border-b border-border px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold">Algo Testing Pro</p>
        <h1 className="mt-0.5 text-lg font-bold">Quant Chat</h1>
        <p className="text-xs text-text-3">Ask anything, describe or upload a strategy, or get real platform code - session only, not saved across a refresh.</p>
      </header>

      <ChatWindow
        messages={streamingDraft ? [...messages, streamingDraft] : messages}
        thinking={thinking}
        error={error}
        streamingId={streamingDraft?.id ?? null}
        onCopy={(content) => navigator.clipboard?.writeText(content)}
        onRetry={() => {}}
        emptyState={{
          title: "Ask anything",
          body: "Trading concepts, indicators, code, or general questions - answered in plain language. Attach a chart screenshot or a strategy file for extra context.",
        }}
      />

      {messages.some((m) => m.role === "assistant") && (
        <div className="border-t border-border px-4 py-2">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-text-3">Generate code for</p>
          <div className="flex flex-wrap gap-2">
            {CODEGEN_TARGETS.map((target) => (
              <Button key={target.label} size="sm" variant="secondary" onClick={() => handleSend(target.instruction)} disabled={thinking || streamingDraft !== null}>
                {target.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 py-2">
        <PromptSuggestions onPick={handleSend} suggestions={quantChatPromptSuggestions} />
      </div>

      <ChatInput
        onSend={handleSend}
        onStop={() => abortRef.current?.abort()}
        isGenerating={thinking || streamingDraft !== null}
        onAttachFile={handleAttachFile}
        attachedFileName={attachedImage?.name ?? attachedFile?.name ?? null}
        attachedImagePreviewUrl={attachedImage?.previewUrl ?? null}
        onRemoveAttachment={() => {
          setAttachedFile(null);
          setAttachedImage(null);
        }}
      />
    </div>
  );
}
