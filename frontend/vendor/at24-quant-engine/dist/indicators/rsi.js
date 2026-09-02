function rsiFromAverages(avgGain, avgLoss) {
    if (avgLoss === 0 && avgGain === 0)
        return 50;
    if (avgLoss === 0)
        return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
}
export const rsi = {
    name: "RSI",
    version: "1.0.0",
    inputs: ["close"],
    outputShape: { kind: "single" },
    warmup: (params) => ({ bars: params.period + 1 }),
    createState: () => ({ prevClose: null, gainSum: 0, lossSum: 0, count: 0, avgGain: null, avgLoss: null }),
    next: (state, bar, params) => {
        if (state.prevClose === null) {
            return { output: null, state: { ...state, prevClose: bar.close } };
        }
        const change = bar.close - state.prevClose;
        const gain = Math.max(change, 0);
        const loss = Math.max(-change, 0);
        if (state.avgGain !== null && state.avgLoss !== null) {
            const nextAvgGain = (state.avgGain * (params.period - 1) + gain) / params.period;
            const nextAvgLoss = (state.avgLoss * (params.period - 1) + loss) / params.period;
            return {
                output: rsiFromAverages(nextAvgGain, nextAvgLoss),
                state: { ...state, prevClose: bar.close, avgGain: nextAvgGain, avgLoss: nextAvgLoss },
            };
        }
        const count = state.count + 1;
        const gainSum = state.gainSum + gain;
        const lossSum = state.lossSum + loss;
        if (count < params.period) {
            return { output: null, state: { ...state, prevClose: bar.close, count, gainSum, lossSum } };
        }
        const avgGain = gainSum / params.period;
        const avgLoss = lossSum / params.period;
        return {
            output: rsiFromAverages(avgGain, avgLoss),
            state: { prevClose: bar.close, gainSum, lossSum, count, avgGain, avgLoss },
        };
    },
};
