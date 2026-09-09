// services/automation/context-path.ts
// AT24 Automation (MVP) - the restricted JSONPath used by condition steps and
// output/keyword bindings.
//
// LOCKED (AUTOMATION_EXECUTION_CONTRACT.md §4.3): a path is ONLY
//   $.steps.<stepId>.<dotted.field.path>   or   $.trigger.<dotted.field.path>
// No wildcards, no filters, no functions, no array slices. This is a plain
// property walk over the run context - never an eval.

/** stepId grammar from the definition: /^[a-z][a-z0-9]{0,15}$/ */
export const STEP_ID_RE = /^[a-z][a-z0-9]{0,15}$/;

/** A full restricted-path grammar check. */
export const CONTEXT_PATH_RE =
  /^\$\.(steps\.[a-z][a-z0-9]{0,15}|trigger)\.[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;

export function isValidContextPath(path: unknown): path is string {
  return typeof path === "string" && CONTEXT_PATH_RE.test(path);
}

/** The step id a `$.steps.<id>.*` path refers to, or null for a $.trigger.* path. */
export function referencedStepId(path: string): string | null {
  const m = /^\$\.steps\.([a-z][a-z0-9]{0,15})\./.exec(path);
  return m ? m[1] : null;
}

/** The run context the dispatcher threads through one run. */
export interface AutomationRunContext {
  trigger: Record<string, unknown>;
  input: Record<string, unknown>;
  steps: Record<string, Record<string, unknown>>;
}

export function emptyRunContext(trigger: Record<string, unknown> = {}, input: Record<string, unknown> = {}): AutomationRunContext {
  return { trigger, input, steps: {} };
}

/**
 * Resolve a restricted path against the run context. Returns `undefined` for
 * any missing segment - a missing value is NOT an error here (the caller
 * decides what a missing condition operand means).
 */
export function resolveContextPath(path: string, ctx: AutomationRunContext): unknown {
  if (!isValidContextPath(path)) return undefined;
  const body = path.slice(2); // drop "$."
  const segments = body.split(".");
  // roots: "steps" "<id>" ... | "trigger" ...
  let cursor: unknown;
  let rest: string[];
  if (segments[0] === "steps") {
    const stepId = segments[1];
    cursor = ctx.steps?.[stepId];
    rest = segments.slice(2);
  } else {
    cursor = ctx.trigger;
    rest = segments.slice(1);
  }
  for (const seg of rest) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return cursor;
}
