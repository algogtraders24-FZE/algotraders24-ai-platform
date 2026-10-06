// services/mcp/facade.ts
// AT24 MCP v1 - the transport-independent facade. A thin layer: authenticated
// principal + tool name + args in, closed-vocabulary result out. It owns NO
// tool logic; every call goes through the existing Tool Gateway (invokeTool).
//
// Structural guarantees (read-only by construction):
//   - the permission policy granted to external callers is a FIXED read-only
//     allowlist; a tool needing anything outside it is refused
//     ("tool_not_read_only"), so a write-capable tool can never be exposed by
//     mistake;
//   - the caller identity comes ONLY from the authenticated principal, never
//     from tool arguments;
//   - tool output is returned as DATA inside typed fields (never as text the
//     client could mistake for instructions), size-capped;
//   - audit records carry no arguments or output, only metadata;
//   - any failure fails closed with a closed-vocabulary error code.

import {
  type PermissionKey,
  type PermissionPolicy,
} from "@/types/agent-framework";
import { invokeTool } from "@/services/agent-framework/tools/tool-gateway";
import type { ToolRegistry } from "@/services/agent-framework/tools/tool-registry";
import { MCP_TOOL_MAP, MCP_TOOL_NAMES, isMcpToolName, type McpToolName } from "./mcp-tool-map";

/** The ONLY permissions an external MCP principal can ever hold. */
export const MCP_READ_PERMISSIONS: readonly PermissionKey[] = [
  "CAN_READ_MARKET_DATA",
  "CAN_READ_NEWS",
  "CAN_RUN_RESEARCH",
  "CAN_RUN_BACKTEST",
] as const;

export const MCP_MAX_OUTPUT_BYTES = 200_000;
export const MCP_DEFAULT_TIMEOUT_MS = 30_000;

export const MCP_DISCLAIMER =
  "Informational analysis only. Not investment advice, not a trading signal. AT24 never places orders.";

export type McpScope = "read";

/** An authenticated caller. Built ONLY by the (future) token authenticator. */
export interface McpPrincipal {
  userId: string;
  tokenId: string;
  scopes: readonly McpScope[];
}

export type McpErrorCode =
  | "service_disabled"
  | "unauthorized"
  | "unknown_tool"
  | "tool_not_read_only"
  | "quota_exceeded"
  | "invalid_input"
  | "permission_denied"
  | "tool_timeout"
  | "tool_error"
  | "output_too_large";

export interface McpCallMeta {
  tool: string;
  creditsConsumed: number;
  durationMs: number;
  evidenceCount: number;
}

export type McpCallResult =
  | {
      isError: false;
      data: unknown;
      provenance: { source: "AT24"; tool: string; retrievedAt: string };
      disclaimer: string;
      meta: McpCallMeta;
    }
  | { isError: true; errorCode: McpErrorCode; message: string; meta: McpCallMeta };

export interface McpAuditRecord {
  tokenId: string;
  userId: string;
  tool: string;
  ok: boolean;
  errorCode?: McpErrorCode;
  creditsConsumed: number;
  durationMs: number;
  at: string;
}

export interface McpQuotaGate {
  check(principal: McpPrincipal, tool: McpToolName): Promise<{ allowed: boolean }>;
}

export interface McpFacadeDeps {
  registry: ToolRegistry;
  audit?: (record: McpAuditRecord) => void | Promise<void>;
  quota?: McpQuotaGate;
  /** Returns true when the whole MCP surface is switched off. */
  killSwitch?: () => boolean;
  timeoutMs?: number;
  now?: () => Date;
}

export interface McpToolListing {
  name: McpToolName;
  title: string;
  description: string;
  inputSchema: unknown;
  annotations: { readOnlyHint: true; destructiveHint: false; openWorldHint: boolean };
}

const MESSAGES: Record<McpErrorCode, string> = {
  service_disabled: "The AT24 MCP service is temporarily unavailable.",
  unauthorized: "Authentication is required or the token lacks the required scope.",
  unknown_tool: "Unknown tool.",
  tool_not_read_only: "This tool is not available over MCP.",
  quota_exceeded: "Usage limit reached for this tool. Try again later.",
  invalid_input: "The arguments were invalid for this tool.",
  permission_denied: "This token is not permitted to use this tool.",
  tool_timeout: "The tool timed out.",
  tool_error: "The tool could not complete. No data was fabricated.",
  output_too_large: "The result exceeded the size limit.",
};

/** Whether a tool reaches an external provider (informational MCP hint). */
const OPEN_WORLD: Record<McpToolName, boolean> = {
  market_snapshot: true,
  market_intelligence: true,
  quant_backtest: false,
  news_search: true,
  economic_calendar: true,
  strategy_library_search: false,
  risk_calculator: false,
};

export function listMcpTools(registry: ToolRegistry): McpToolListing[] {
  const out: McpToolListing[] = [];
  for (const name of MCP_TOOL_NAMES) {
    const impl = registry.get(MCP_TOOL_MAP[name]);
    if (!impl) continue;
    const d = impl.definition;
    if (!d.requiredPermissions.every((p) => MCP_READ_PERMISSIONS.includes(p))) continue;
    out.push({
      name,
      title: d.name,
      description: d.description,
      inputSchema: d.inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: OPEN_WORLD[name] },
    });
  }
  return out;
}

function deny(code: McpErrorCode, tool: string, durationMs = 0): McpCallResult {
  return { isError: true, errorCode: code, message: MESSAGES[code], meta: { tool, creditsConsumed: 0, durationMs, evidenceCount: 0 } };
}

function mapErrorKind(status: string, errorKind: string | undefined): McpErrorCode {
  if (status === "invalid_input") return errorKind === "unknown_tool" ? "unknown_tool" : "invalid_input";
  if (status === "permission_denied") return "permission_denied";
  if (status === "tool_timeout") return "tool_timeout";
  return "tool_error";
}

export async function callMcpTool(
  deps: McpFacadeDeps,
  principal: McpPrincipal | null,
  name: string,
  args: unknown,
): Promise<McpCallResult> {
  const now = deps.now ?? (() => new Date());
  const finish = async (res: McpCallResult): Promise<McpCallResult> => {
    if (deps.audit && principal) {
      try {
        await deps.audit({
          tokenId: principal.tokenId,
          userId: principal.userId,
          tool: name.slice(0, 64),
          ok: !res.isError,
          errorCode: res.isError ? res.errorCode : undefined,
          creditsConsumed: res.meta.creditsConsumed,
          durationMs: res.meta.durationMs,
          at: now().toISOString(),
        });
      } catch {
        // Audit failure must never turn into a data leak or a crash; the
        // production sink additionally alerts. Fail-soft on the response.
      }
    }
    return res;
  };

  if (deps.killSwitch?.()) return deny("service_disabled", name);
  if (!principal || !principal.userId || !principal.tokenId || !principal.scopes.includes("read")) {
    return deny("unauthorized", name);
  }
  if (!isMcpToolName(name)) return finish(deny("unknown_tool", name));

  const afToolId = MCP_TOOL_MAP[name];
  const impl = deps.registry.get(afToolId);
  if (!impl) return finish(deny("unknown_tool", name));

  const required = impl.definition.requiredPermissions;
  if (!required.every((p) => MCP_READ_PERMISSIONS.includes(p))) {
    return finish(deny("tool_not_read_only", name));
  }

  if (deps.quota) {
    let allowed = false;
    try {
      allowed = (await deps.quota.check(principal, name)).allowed;
    } catch {
      allowed = false; // fail closed
    }
    if (!allowed) return finish(deny("quota_exceeded", name));
  }

  const policy: PermissionPolicy = { granted: [...MCP_READ_PERMISSIONS] };
  const outcome = await invokeTool({
    registry: deps.registry,
    intent: {
      toolId: afToolId,
      toolVersion: impl.definition.version,
      input: args,
      authorizedBy: [...required],
      creditsReserved: 0,
    },
    permissionPolicy: policy,
    autonomyLevel: 0,
    context: { userId: principal.userId },
    timeoutMs: deps.timeoutMs ?? MCP_DEFAULT_TIMEOUT_MS,
  });

  const { result, evidence } = outcome;
  const meta: McpCallMeta = {
    tool: name,
    creditsConsumed: result.creditsConsumed,
    durationMs: result.durationMs,
    evidenceCount: evidence.length,
  };

  if (result.status !== "ok") {
    const code = mapErrorKind(result.status, result.errorKind);
    return finish({ isError: true, errorCode: code, message: MESSAGES[code], meta });
  }

  let size = 0;
  try {
    size = JSON.stringify(result.output).length;
  } catch {
    return finish({ isError: true, errorCode: "tool_error", message: MESSAGES.tool_error, meta });
  }
  if (size > MCP_MAX_OUTPUT_BYTES) {
    return finish({ isError: true, errorCode: "output_too_large", message: MESSAGES.output_too_large, meta });
  }

  return finish({
    isError: false,
    data: result.output,
    provenance: { source: "AT24", tool: name, retrievedAt: now().toISOString() },
    disclaimer: MCP_DISCLAIMER,
    meta,
  });
}
