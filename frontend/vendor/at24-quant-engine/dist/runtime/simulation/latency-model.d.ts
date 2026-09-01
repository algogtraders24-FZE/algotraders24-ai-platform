import type { LatencyModel } from "../../domain/reality-models.js";
/**
 * Q0.5.14: ZeroLatency only. The interface itself (Q0.2's LatencyModel)
 * already accommodates FixedLatency/DistributionLatency; those remain
 * unimplemented, deliberately, for a future sprint.
 */
export declare const ZeroLatency: LatencyModel & {
    readonly name: string;
};
