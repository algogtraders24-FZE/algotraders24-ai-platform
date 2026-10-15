// services/support/after-response.ts
// Run best-effort side effects (ticket emails, ops alert) AFTER the HTTP response has been
// sent, so they never add to the time the user waits for an answer. Outside a Next request
// scope (validation scripts, tests) `after()` throws, and the task simply runs inline, so
// behaviour there is unchanged.
import { after } from "next/server";

export async function runAfterResponse(task: () => Promise<void>): Promise<void> {
  try {
    after(task);
    return;
  } catch {
    // not inside a request scope - run now
  }
  await task();
}
