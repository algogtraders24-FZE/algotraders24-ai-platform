export const sma = {
    name: "SMA",
    version: "1.0.0",
    inputs: ["close"],
    outputShape: { kind: "single" },
    warmup: (params) => ({ bars: params.period }),
    createState: () => ({ window: [] }),
    next: (state, bar, params) => {
        const window = [...state.window, bar.close].slice(-params.period);
        if (window.length < params.period) {
            return { output: null, state: { window } };
        }
        const sum = window.reduce((a, b) => a + b, 0);
        return { output: sum / params.period, state: { window } };
    },
};
