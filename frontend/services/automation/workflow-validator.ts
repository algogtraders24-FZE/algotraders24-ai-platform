// services/automation/workflow-validator.ts
// AT24 Automation (MVP) - the ONE validator for a versioned workflow
// definition. A definition must pass this before an automation may be
// activated on it (AUTOMATION_DATA_MODEL.md §4.1, AUTOMATION_EXECUTION_
// CONTRACT.md §2).
//
// Pure + deterministic - no DB, no clock beyond `now` passed in for the
// `once.runAt` future check. Returns every issue found (not just the first).

import {
  AUTOMATION_AGENT_TYPES,
  AUTOMATION_CONDITION_OPS,
  AUTOMATION_TRIGGER_TYPES,
  AUTOMATION_WEEKDAYS,
  type AutomationValidationIssue,
  type AutomationValidationResult,
  type AutomationWorkflowDefinition,
} from "@/types/automation";
import { CONTENT_CATEGORIES } from "@/types/content-category";
import { isAutomationSlotId, AUTOMATION_SCHEDULE_TIMEZONE } from "@/config/automation-slots";
import { STEP_ID_RE, isValidContextPath, referencedStepId } from "./context-path";

const MAX_DEFINITION_BYTES = 16 * 1024;
const MIN_STEPS = 1;
const MAX_STEPS = 8;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isValidIanaZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function validateWorkflowDefinition(
  raw: unknown,
  opts: { now?: Date } = {},
): AutomationValidationResult {
  const now = opts.now ?? new Date();
  const issues: AutomationValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  if (!isPlainObject(raw)) {
    return { ok: false, issues: [{ path: "$", message: "definition must be a JSON object" }] };
  }

  // Size
  try {
    if (Buffer.byteLength(JSON.stringify(raw), "utf8") > MAX_DEFINITION_BYTES) {
      add("$", `definition exceeds ${MAX_DEFINITION_BYTES} bytes`);
    }
  } catch {
    add("$", "definition is not serialisable JSON");
    return { ok: false, issues };
  }

  const def = raw as Partial<AutomationWorkflowDefinition>;

  if (def.schemaVersion !== 1) add("$.schemaVersion", "schemaVersion must be 1");

  // ── trigger ──
  const trigger = def.trigger;
  if (!isPlainObject(trigger)) {
    add("$.trigger", "trigger must be an object");
  } else {
    const ttype = trigger.type;
    if (typeof ttype !== "string" || !(AUTOMATION_TRIGGER_TYPES as readonly string[]).includes(ttype)) {
      add("$.trigger.type", `type must be one of: ${AUTOMATION_TRIGGER_TYPES.join(", ")}`);
    }
    if (!isValidIanaZone(trigger.timezone)) {
      add("$.trigger.timezone", "timezone must be a valid IANA zone");
    }
    const scheduled = ttype === "once" || ttype === "daily" || ttype === "weekly";
    if (scheduled) {
      // Beta: forced IST
      if (trigger.timezone !== AUTOMATION_SCHEDULE_TIMEZONE) {
        add(
          "$.trigger.timezone",
          `Beta scheduled automations run on ${AUTOMATION_SCHEDULE_TIMEZONE}; custom timezones are post-Beta`,
        );
      }
      if (!isAutomationSlotId(trigger.slot)) {
        add("$.trigger.slot", "slot must be a valid Beta slot id (morning_ist | evening_ist)");
      }
    }
    if (ttype === "weekly") {
      const days = trigger.daysOfWeek;
      if (!Array.isArray(days) || days.length === 0) {
        add("$.trigger.daysOfWeek", "weekly triggers need a non-empty daysOfWeek array");
      } else {
        const bad = days.filter((d) => !(AUTOMATION_WEEKDAYS as readonly string[]).includes(d as string));
        if (bad.length) add("$.trigger.daysOfWeek", `invalid weekday codes: ${bad.join(", ")}`);
        if (new Set(days).size !== days.length) add("$.trigger.daysOfWeek", "duplicate weekday codes");
      }
    } else if (trigger.daysOfWeek !== undefined) {
      add("$.trigger.daysOfWeek", "daysOfWeek is only valid for weekly triggers");
    }
    if (ttype === "once") {
      const runAt = trigger.runAt;
      const t = typeof runAt === "string" ? Date.parse(runAt) : NaN;
      if (Number.isNaN(t)) add("$.trigger.runAt", "once triggers need a valid ISO runAt date");
      else if (t < now.getTime()) add("$.trigger.runAt", "runAt must be in the future");
    } else if (trigger.runAt !== undefined) {
      add("$.trigger.runAt", "runAt is only valid for once triggers");
    }
    if (ttype === "manual" && trigger.slot !== undefined) {
      add("$.trigger.slot", "manual triggers do not take a slot");
    }
  }

  // ── steps ──
  const steps = def.steps;
  if (!Array.isArray(steps)) {
    add("$.steps", "steps must be an array");
    return { ok: issues.length === 0, issues };
  }
  if (steps.length < MIN_STEPS || steps.length > MAX_STEPS) {
    add("$.steps", `steps must contain ${MIN_STEPS}-${MAX_STEPS} entries`);
  }

  const seenIds = new Set<string>();
  const priorIds = new Set<string>();
  const rawSteps = steps as unknown[];

  rawSteps.forEach((step, i) => {
    const p = `$.steps[${i}]`;
    if (!isPlainObject(step)) {
      add(p, "step must be an object");
      return;
    }
    const prev = i > 0 ? rawSteps[i - 1] : null;
    const id = step.id;
    if (typeof id !== "string" || !STEP_ID_RE.test(id)) {
      add(`${p}.id`, "id must match /^[a-z][a-z0-9]{0,15}$/");
    } else if (seenIds.has(id)) {
      add(`${p}.id`, `duplicate step id "${id}"`);
    } else {
      seenIds.add(id);
    }

    const kind = step.kind;
    if (kind === "condition" && i === 0) {
      add(p, "the first step may not be a condition");
    }
    if (kind === "condition" && isPlainObject(prev) && prev.kind === "condition") {
      add(p, "two condition steps may not be adjacent");
    }

    const checkPath = (val: unknown, at: string) => {
      if (!isValidContextPath(val)) {
        add(at, "must be a restricted context path: $.steps.<id>.<field> or $.trigger.<field>");
        return;
      }
      const ref = referencedStepId(val as string);
      if (ref && !priorIds.has(ref)) {
        add(at, `path references step "${ref}" which is not an earlier step`);
      }
    };

    switch (kind) {
      case "agent_run": {
        const action = isPlainObject(step.action) ? step.action : null;
        if (!action) {
          add(`${p}.action`, "agent_run needs an action object");
          break;
        }
        if (typeof action.agentType !== "string" || !(AUTOMATION_AGENT_TYPES as readonly string[]).includes(action.agentType)) {
          add(`${p}.action.agentType`, `agentType must be one of: ${AUTOMATION_AGENT_TYPES.join(", ")}`);
        }
        if (!isPlainObject(action.input)) {
          add(`${p}.action.input`, "input must be a JSON object");
        }
        if (step.outputBindings !== undefined) {
          if (!isPlainObject(step.outputBindings)) {
            add(`${p}.outputBindings`, "outputBindings must be an object");
          } else {
            for (const [k, v] of Object.entries(step.outputBindings)) {
              if (typeof v !== "string" || v.length === 0) {
                add(`${p}.outputBindings.${k}`, "binding target must be a non-empty JSONPath string");
              }
            }
          }
        }
        break;
      }
      case "condition": {
        const c = isPlainObject(step.condition) ? step.condition : null;
        if (!c) {
          add(`${p}.condition`, "condition step needs a condition object");
          break;
        }
        checkPath(c.left, `${p}.condition.left`);
        if (typeof c.op !== "string" || !(AUTOMATION_CONDITION_OPS as readonly string[]).includes(c.op)) {
          add(`${p}.condition.op`, `op must be one of: ${AUTOMATION_CONDITION_OPS.join(", ")}`);
        }
        const rt = typeof c.right;
        if (rt !== "string" && rt !== "number" && rt !== "boolean") {
          add(`${p}.condition.right`, "right must be a string, number, or boolean literal");
        }
        break;
      }
      case "publication_draft": {
        const action = isPlainObject(step.action) ? step.action : null;
        if (!action) {
          add(`${p}.action`, "publication_draft needs an action object");
          break;
        }
        if (typeof action.category !== "string" || !(CONTENT_CATEGORIES as string[]).includes(action.category)) {
          add(`${p}.action.category`, `category must be one of: ${CONTENT_CATEGORIES.join(", ")}`);
        }
        if (action.keywords !== undefined) {
          if (!Array.isArray(action.keywords) || action.keywords.some((k) => typeof k !== "string")) {
            add(`${p}.action.keywords`, "keywords must be an array of strings");
          }
        }
        if (action.keywordsFrom !== undefined) checkPath(action.keywordsFrom, `${p}.action.keywordsFrom`);
        if (action.aiOverviewFrom !== undefined) checkPath(action.aiOverviewFrom, `${p}.action.aiOverviewFrom`);
        break;
      }
      case "workspace_save": {
        const action = isPlainObject(step.action) ? step.action : null;
        if (!action) {
          add(`${p}.action`, "workspace_save needs an action object");
          break;
        }
        if (typeof action.title !== "string" || action.title.trim().length === 0) {
          add(`${p}.action.title`, "title must be a non-empty string");
        }
        checkPath(action.from, `${p}.action.from`);
        break;
      }
      default:
        add(`${p}.kind`, `unknown step kind "${String(kind)}"`);
    }

    if (typeof id === "string" && STEP_ID_RE.test(id)) priorIds.add(id);
  });

  return { ok: issues.length === 0, issues };
}
