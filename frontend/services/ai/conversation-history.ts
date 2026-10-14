// services/ai/conversation-history.ts
// Cleans the persisted history that is handed to the model as "prior turns".
//
// The chat route saves the user's message BEFORE answering. If an earlier turn never got an answer (the request
// failed or the tab was closed), the history holds two user messages in a row, and the model reads them as one
// message - which showed up live as an answer to the OLD question. A user message that is directly followed by
// another user message was never answered, so it is dropped from the model's history (it stays in the saved chat).

export function dropUnansweredUserTurns<T extends { role: string }>(messages: readonly T[]): T[] {
  return messages.filter((m, i) => !(m.role === "user" && i + 1 < messages.length && messages[i + 1].role === "user"));
}

/**
 * Same rule for the history that sits BEFORE the current question: the current message is not part of `prior`,
 * so a trailing user message in `prior` is also unanswered (the current question follows it directly).
 */
export function priorTurnsForModel<T extends { role: string }>(prior: readonly T[]): T[] {
  const cleaned = dropUnansweredUserTurns(prior);
  const last = cleaned[cleaned.length - 1];
  return last && last.role === "user" ? cleaned.slice(0, -1) : cleaned;
}
