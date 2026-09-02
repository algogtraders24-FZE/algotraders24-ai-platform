export const atr = {
    name: "ATR",
    version: "1.0.0",
    inputs: ["high", "low", "close"],
    outputShape: { kind: "single" },
    warmup: (params) => ({ bars: params.period }),
    createState: () => ({ prevClose: null, trWindow: [], atr: null }),
    next: (state, bar, params) => {
        const tr = state.prevClose === null
            ? bar.high - bar.low
            : Math.max(bar.high - bar.low, Math.abs(bar.high - state.prevClose), Math.abs(bar.low - state.prevClose));
        if (state.atr !== null) {
            const nextAtr = (state.atr * (params.period - 1) + tr) / params.period;
            return { output: nextAtr, state: { prevClose: bar.close, trWindow: state.trWindow, atr: nextAtr } };
        }
        const trWindow = [...state.trWindow, tr];
        if (trWindow.length < params.period) {
            return { output: null, state: { prevClose: bar.close, trWindow, atr: null } };
        }
        const seed = trWindow.reduce((a, b) => a + b, 0) / params.period;
        return { output: seed, state: { prevClose: bar.close, trWindow, atr: seed } };
    },
};
