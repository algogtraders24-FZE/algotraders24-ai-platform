/**
 * Folds `next()` over an ordered bar sequence. This is the ONLY batch
 * entry point — it does not reimplement any indicator math, so it cannot
 * diverge from the incremental (production) path.
 */
export function calculateSeries(def, bars, params) {
    let state = def.createState(params);
    const outputs = [];
    for (const bar of bars) {
        const step = def.next(state, bar, params);
        outputs.push(step.output);
        state = step.state;
    }
    return outputs;
}
