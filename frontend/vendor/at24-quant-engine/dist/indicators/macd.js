import { ema } from "./ema.js";
export const macd = {
    name: "MACD",
    version: "1.0.0",
    inputs: ["close"],
    outputShape: { kind: "multi", fields: ["line", "signal", "histogram"] },
    warmup: (params) => ({ bars: params.slowPeriod + params.signalPeriod - 1 }),
    createState: () => ({
        fastState: ema.createState({ period: 0 }),
        slowState: ema.createState({ period: 0 }),
        signalSeedWindow: [],
        signalEma: null,
    }),
    next: (state, bar, params) => {
        const fastStep = ema.next(state.fastState, bar, { period: params.fastPeriod });
        const slowStep = ema.next(state.slowState, bar, { period: params.slowPeriod });
        if (fastStep.output === null || slowStep.output === null) {
            return {
                output: null,
                state: {
                    fastState: fastStep.state,
                    slowState: slowStep.state,
                    signalSeedWindow: state.signalSeedWindow,
                    signalEma: state.signalEma,
                },
            };
        }
        const line = fastStep.output - slowStep.output;
        if (state.signalEma !== null) {
            const k = 2 / (params.signalPeriod + 1);
            const nextSignal = line * k + state.signalEma * (1 - k);
            return {
                output: { line, signal: nextSignal, histogram: line - nextSignal },
                state: {
                    fastState: fastStep.state,
                    slowState: slowStep.state,
                    signalSeedWindow: state.signalSeedWindow,
                    signalEma: nextSignal,
                },
            };
        }
        const signalSeedWindow = [...state.signalSeedWindow, line];
        if (signalSeedWindow.length < params.signalPeriod) {
            return {
                output: null,
                state: { fastState: fastStep.state, slowState: slowStep.state, signalSeedWindow, signalEma: null },
            };
        }
        const seed = signalSeedWindow.reduce((a, b) => a + b, 0) / params.signalPeriod;
        return {
            output: { line, signal: seed, histogram: line - seed },
            state: { fastState: fastStep.state, slowState: slowStep.state, signalSeedWindow, signalEma: seed },
        };
    },
};
