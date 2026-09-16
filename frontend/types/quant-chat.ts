// types/quant-chat.ts
// QP-2 - Conversational Strategy Builder. In-memory-only conversation
// state (locked decision: no Prisma table, no migration, no durable
// store, no fake "restored" behavior - refresh means this state is
// genuinely gone, same as it says).
import type { CompileNaturalLanguageStrategyResult } from "@/services/algo-test/nl-strategy-compiler.service";

export type QuantChatTurnMode = "modify" | "explain";

/**
 * "parameter" / "logic" / "mixed" are derived, best-effort labels from a
 * structural diff between the previous and new compiled StrategySpec -
 * never asserted with more confidence than the diff actually supports.
 * "unknown" is the honest fallback when a reliable distinction can't be
 * derived (locked decision: never fabricate precision the system can't
 * prove) - it is not an error state, just a less-specific label.
 */
export type QuantChatModificationKind = "parameter" | "logic" | "mixed" | "unknown";

export interface QuantChatTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly mode?: QuantChatTurnMode;
  readonly modificationKind?: QuantChatModificationKind;
  readonly createdAt: string;
}

export interface QuantChatConversationState {
  readonly turns: readonly QuantChatTurn[];
  /** The accumulated natural-language description actually sent to compileNaturalLanguageStrategy() - never re-derived elsewhere, this IS the compiler's real input. */
  readonly currentIntent: string;
  /** The last compiler result, reused as-is - never re-interpreted or re-validated by this layer. */
  readonly lastCompileResult?: CompileNaturalLanguageStrategyResult;
}

export const EMPTY_QUANT_CHAT_STATE: QuantChatConversationState = { turns: [], currentIntent: "" };

/**
 * The shape MessageBubble.tsx's own additive `strategyState` field
 * renders (StrategyStateCard) - a small, presentation-facing view over a
 * CompileNaturalLanguageStrategyResult, never a second copy of it.
 */
export interface QuantChatMessageStrategyState {
  readonly compileResult: CompileNaturalLanguageStrategyResult;
  readonly explanation?: string;
}
