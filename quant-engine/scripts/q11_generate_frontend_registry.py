"""
Q1.1 - converts the real gap registry audit output
(quant-engine/output/q11_gap_registry.json) into a static TypeScript data
file, the same pattern q08_gen_frontend_data.py established for the
strategy library sample. Read-only w.r.t. market.db (reads only the
already-written JSON); the only write is the generated .ts file.
"""
import json
import os

REPO_ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
IN_PATH = os.path.join(REPO_ROOT, "quant-engine", "output", "q11_gap_registry.json")
OUT_PATH = os.path.join(REPO_ROOT, "frontend", "data", "quant-lite-gap-registry.ts")


def ts_duration_days(start, end):
    from datetime import datetime
    s = datetime.fromisoformat(start)
    e = datetime.fromisoformat(end)
    return round((e - s).total_seconds() / 86400.0, 2)


def main():
    with open(IN_PATH) as f:
        data = json.load(f)

    lines = []
    lines.append("/**")
    lines.append(" * GENERATED FILE - do not hand-edit. Produced by")
    lines.append(" * quant-engine/scripts/q11_generate_frontend_registry.py from the real")
    lines.append(" * gap-registry audit (quant-engine/scripts/q11_gap_registry.py), which")
    lines.append(" * reads quant_engine/market.db directly and read-only. Regenerate this")
    lines.append(" * file by re-running both scripts after market.db changes - see")
    lines.append(" * Q1.1_GAP_REGISTRY.md \"Refresh Model\".")
    lines.append(" */")
    lines.append('import type { DataCoverage } from "@/types/quant-lite-coverage";')
    lines.append("")
    lines.append(f'export const GAP_REGISTRY_VERSION = "{data["registryVersion"]}";')
    lines.append(f'export const GAP_REGISTRY_AUDIT_RULE_VERSION = "{data["auditRuleVersion"]}";')
    lines.append(f'export const GAP_REGISTRY_MARKET_DB_SHA256 = "{data["marketDbSha256"]}";')
    lines.append("")
    lines.append("export const DATA_COVERAGE_REGISTRY: DataCoverage[] = [")
    for entry in data["entries"]:
        gaps_ts = []
        for g in entry["gaps"]:
            duration = ts_duration_days(g["start"], g["end"])
            gaps_ts.append(
                "    { symbol: %r, timeframe: %r, start: %r, end: %r, durationDays: %s, gapType: %r, severity: %r }"
                % (entry["symbol"], entry["timeframe"], g["start"], g["end"], duration, g["gapType"], g["severity"])
            )
        gaps_block = ",\n".join(gaps_ts)
        lines.append("  {")
        lines.append(f"    symbol: {entry['symbol']!r},")
        lines.append(f"    timeframe: {entry['timeframe']!r},")
        lines.append(f"    sessionModel: {entry['sessionModel']!r},")
        lines.append(f"    minTs: {entry['minTs']!r},")
        lines.append(f"    maxTs: {entry['maxTs']!r},")
        lines.append(f"    rows: {entry['rows']},")
        lines.append(f"    coveragePct: {entry['coveragePct']},")
        lines.append(f"    gapCount: {entry['gapCount']},")
        lines.append(f"    largestGapDays: {entry['largestGapDays']},")
        lines.append(f"    sessionBreakCount: {entry.get('sessionBreakCount', 0)},")
        lines.append(f"    sessionBreakDays: {entry.get('sessionBreakDays', 0)},")
        lines.append("    gaps: [")
        if gaps_block:
            lines.append(gaps_block)
        lines.append("    ],")
        lines.append("  },")
    lines.append("];")

    content = "\n".join(lines).replace("'", '"') + "\n"
    with open(OUT_PATH, "w") as f:
        f.write(content)
    print(f"Written: {OUT_PATH} ({len(data['entries'])} entries)")


if __name__ == "__main__":
    main()
