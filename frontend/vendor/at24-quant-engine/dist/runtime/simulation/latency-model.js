/**
 * Q0.5.14: ZeroLatency only. The interface itself (Q0.2's LatencyModel)
 * already accommodates FixedLatency/DistributionLatency; those remain
 * unimplemented, deliberately, for a future sprint.
 */
export const ZeroLatency = {
    name: "ZeroLatency",
    computeDelayMs: () => 0,
};
