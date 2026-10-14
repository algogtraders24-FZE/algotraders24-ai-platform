// lib/knowledge/trading-rules.ts
// "My Trading Rules": a guided form that turns a trader's own rules into ONE plain-text document
// that is indexed in their Knowledge Base, so Ask AI answers with those rules in mind (and cites the
// document). Pure: no network, no clock. The text only restates what the user typed - nothing is added
// to, inferred from, or "improved" in the rules.

export const TRADING_RULES_TITLE = "My Trading Rules";
export const TRADING_RULES_CATEGORY = "Risk Management";

export interface TradingRulesForm {
  /** Max risk per trade, % of account (0-100). */
  riskPerTradePct: string;
  /** Max loss per day, % of account. */
  dailyLossPct: string;
  /** Max total drawdown, % of account. */
  maxDrawdownPct: string;
  /** e.g. "XAUUSD, EURUSD". */
  instruments: string;
  /** e.g. "London and New York sessions only". */
  sessions: string;
  /** Free text: when you will NOT trade (news, Fridays, after 2 losses...). */
  noTradeRules: string;
  /** Prop firm name, optional. */
  propFirm: string;
  /** The prop firm's own rules, pasted or typed by the user. */
  propFirmRules: string;
  /** Anything else. */
  otherRules: string;
}

export const EMPTY_TRADING_RULES: TradingRulesForm = {
  riskPerTradePct: "",
  dailyLossPct: "",
  maxDrawdownPct: "",
  instruments: "",
  sessions: "",
  noTradeRules: "",
  propFirm: "",
  propFirmRules: "",
  otherRules: "",
};

const MAX_FIELD_CHARS = 4000;
const PERCENT_FIELDS = ["riskPerTradePct", "dailyLossPct", "maxDrawdownPct"] as const;
const PERCENT_LABELS: Record<(typeof PERCENT_FIELDS)[number], string> = {
  riskPerTradePct: "Risk per trade",
  dailyLossPct: "Daily loss limit",
  maxDrawdownPct: "Maximum drawdown",
};

function clean(s: string): string {
  return s.replace(/\r\n/g, "\n").trim();
}

/** Returns a list of problems (empty = ok). A percent must be a number above 0 and at most 100. */
export function validateTradingRules(form: TradingRulesForm): string[] {
  const problems: string[] = [];
  const filled = Object.values(form).some((v) => clean(v).length > 0);
  if (!filled) problems.push("Fill in at least one rule.");
  for (const key of PERCENT_FIELDS) {
    const raw = clean(form[key]);
    if (raw === "") continue;
    const n = Number(raw.replace(/%$/, ""));
    if (!Number.isFinite(n) || n <= 0 || n > 100) problems.push(`${PERCENT_LABELS[key]} must be a number between 0 and 100.`);
  }
  for (const [key, value] of Object.entries(form)) {
    if (clean(value).length > MAX_FIELD_CHARS) problems.push(`"${key}" is longer than ${MAX_FIELD_CHARS} characters.`);
  }
  return problems;
}

function pct(raw: string): string {
  return `${clean(raw).replace(/%$/, "")}%`;
}

const REMINDER_MAX_CHARS = 700;

/**
 * A short, deterministic reminder of the user's own saved rules, appended under a market-analysis answer.
 * That path is a verified, template-checked answer, so the rules are NOT fed to a model there; they are shown
 * as the user's own text and the note says plainly that the analysis did not check against them.
 * Returns "" when there is nothing to show.
 */
export function rulesReminder(rulesDoc: string): string {
  const lines = rulesDoc
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("# ") && !l.startsWith("These are the trader's own written rules"))
    .map((l) => (l.startsWith("## ") ? `${l.slice(3)}:` : l));
  if (lines.length === 0) return "";
  let body = lines.join("\n");
  if (body.length > REMINDER_MAX_CHARS) body = `${body.slice(0, REMINDER_MAX_CHARS).trimEnd()}...`;
  return `Your saved trading rules (shown for reference - this analysis did not check anything against them):\n${body}`;
}

/** The markdown document that gets indexed. Only filled fields appear. */
export function buildTradingRulesMarkdown(form: TradingRulesForm): string {
  const out: string[] = [
    `# ${TRADING_RULES_TITLE}`,
    "These are the trader's own written rules. When answering this user, treat them as their personal constraints. Do not invent rules that are not listed here.",
  ];

  const risk: string[] = [];
  for (const key of PERCENT_FIELDS) {
    if (clean(form[key]) !== "") risk.push(`- ${PERCENT_LABELS[key]}: ${pct(form[key])} of the account`);
  }
  if (risk.length > 0) out.push("## Risk limits", risk.join("\n"));

  const style: string[] = [];
  if (clean(form.instruments)) style.push(`- Instruments I trade: ${clean(form.instruments)}`);
  if (clean(form.sessions)) style.push(`- Sessions / times I trade: ${clean(form.sessions)}`);
  if (style.length > 0) out.push("## What and when I trade", style.join("\n"));

  if (clean(form.noTradeRules)) out.push("## When I do not trade", clean(form.noTradeRules));

  if (clean(form.propFirm) || clean(form.propFirmRules)) {
    out.push(
      `## Prop firm${clean(form.propFirm) ? `: ${clean(form.propFirm)}` : ""}`,
      clean(form.propFirmRules) ||
        "(No rules text was added. The firm's own current terms are the only binding source.)",
    );
  }

  if (clean(form.otherRules)) out.push("## Other rules", clean(form.otherRules));

  return out.join("\n\n") + "\n";
}
