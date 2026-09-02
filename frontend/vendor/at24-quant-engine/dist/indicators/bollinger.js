export const bollinger = {
    name: "BOLLINGER",
    version: "1.0.0",
    inputs: ["close"],
    outputShape: { kind: "multi", fields: ["upper", "middle", "lower"] },
    warmup: (params) => ({ bars: params.period }),
    createState: () => ({ window: [] }),
    next: (state, bar, params) => {
        const window = [...state.window, bar.close].slice(-params.period);
        if (window.length < params.period) {
            return { output: null, state: { window } };
        }
        const middle = window.reduce((a, b) => a + b, 0) / params.period;
        const variance = window.reduce((acc, v) => acc + (v - middle) ** 2, 0) / params.period;
        const stddev = Math.sqrt(variance);
        return {
            output: {
                upper: middle + params.stdDevMultiplier * stddev,
                middle,
                lower: middle - params.stdDevMultiplier * stddev,
            },
            state: { window },
        };
    },
};
