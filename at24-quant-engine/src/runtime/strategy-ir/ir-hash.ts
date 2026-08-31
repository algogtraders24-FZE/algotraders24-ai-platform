import type { StrategyIR } from "../../domain/strategy-ir/strategy-ir.js";
import { computeCanonicalHash } from "../determinism.js";
import { canonicalizeStrategyIR } from "./canonicalize.js";

/**
 * Q0.7.34 — deterministic. Excludes `strategyId` and `metadata` (which
 * carries `createdAt`) exactly as Q0.2's `computeSemanticStrategyHash`
 * excludes `StrategySpec.metadata` — the identical exclusion discipline,
 * applied to the IR layer. `strategyVersion`/`sourcePlatform`/
 * `sourceLanguage`/`sourceVersion`/`sourceHash`/`irVersion`/`provenance`
 * ARE included: they are facts ABOUT this IR (Q0.7.1's required
 * identity fields), not decorative metadata — two IRs from genuinely
 * different platforms are expected to hash differently even if their
 * underlying trading logic is equivalent; `runtime/strategy-ir/parity-engine.ts`
 * (not hash equality) is the tool for detecting THAT kind of equivalence.
 *
 * Canonicalizes (`canonicalizeStrategyIR`) BEFORE hashing so operand
 * order inside commutative AND/OR expressions never affects the hash
 * (Q0.7.36).
 */
export function computeCanonicalIRHash(ir: StrategyIR): string {
  const canonical = canonicalizeStrategyIR(ir);
  const { strategyId: _strategyId, metadata: _metadata, ...semantic } = canonical;
  return computeCanonicalHash(semantic);
}

/**
 * Q0.8.49 — a DELIBERATELY NARROWER hash than `computeCanonicalIRHash`
 * above, additively extending this module: excludes every identity/origin
 * field (`strategyId`, `strategyVersion`, `sourcePlatform`,
 * `sourceLanguage`, `sourceVersion`, `sourceHash`, `irVersion`,
 * `metadata`, `provenance`) so that the SAME semantic strategy imported
 * from two different platforms (e.g. an equivalent MQL4 and MQL5 source
 * pair) hashes IDENTICALLY, as Q0.8.49 requires — platform-specific
 * metadata must never alter this hash. This does not replace
 * `computeCanonicalIRHash` (which intentionally treats platform identity
 * as part of what it certifies) — the two answer different questions:
 * "is this the exact same IR record" (canonical) vs. "does this describe
 * the exact same trading behavior, regardless of where it came from"
 * (cross-platform semantic).
 */
export function computeCrossPlatformSemanticHash(ir: StrategyIR): string {
  const canonical = canonicalizeStrategyIR(ir);
  const {
    strategyId: _strategyId,
    strategyVersion: _strategyVersion,
    sourcePlatform: _sourcePlatform,
    sourceLanguage: _sourceLanguage,
    sourceVersion: _sourceVersion,
    sourceHash: _sourceHash,
    irVersion: _irVersion,
    metadata: _metadata,
    provenance: _provenance,
    ...semantic
  } = canonical;
  return computeCanonicalHash(semantic);
}
