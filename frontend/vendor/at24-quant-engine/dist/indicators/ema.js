export const ema = {
    name: "EMA",
    version: "1.0.0",
    inputs: ["close"],
    outputShape: { kind: "single" },
    warmup: (params) => ({ bars: params.period }),
    createState: () => ({ seedWindow: [], ema: null }),
    next: (state, bar, params) => {
        if (state.ema !== null) {
            const k = 2 / (params.period + 1);
            const nextEma = bar.close * k + state.ema * (1 - k);
            return { output: nextEma, state: { seedWindow: state.seedWindow, ema: nextEma } };
        }
        const seedWindow = [...state.seedWindow, bar.close];
        if (seedWindow.length < params.period) {
            return { output: null, state: { seedWindow, ema: null } };
        }
        const seed = seedWindow.reduce((a, b) => a + b, 0) / params.period;
        return { output: seed, state: { seedWindow, ema: seed } };
    },
};
