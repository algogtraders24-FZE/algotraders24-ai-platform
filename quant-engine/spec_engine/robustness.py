"""
Out-of-sample consistency check for a FIXED spec (params already chosen —
by the wizard, the library grid, or the LLM parser). This is deliberately
simpler than quant_engine/optimizer.py's walk_forward(): that one
re-optimizes params per fold (walk-forward OPTIMIZATION, used once to
validate the original pullback-breakout EA's params). Here the params are
already fixed, so we only need walk-forward EVALUATION — run the same
spec across N sequential, non-overlapping chronological folds and check
how consistently it holds up. This is exactly the multiple-comparisons
defense a strategy library needs: a spec that looks great over the full
period but only worked in one lucky fold should score low here.
"""
import numpy as np


def spec_walk_forward(df, spec, risk, run_spec_backtest, n_folds=5, min_trades_per_fold=5):
    n = len(df)
    bounds = np.linspace(0, n, n_folds + 1, dtype=int)

    fold_metrics = []
    for i in range(n_folds):
        fold_df = df.iloc[bounds[i]:bounds[i + 1]].reset_index(drop=True)
        if len(fold_df) < 50:
            fold_metrics.append({"trades_total": 0})
            continue
        _, _, m = run_spec_backtest(fold_df, spec, risk)
        fold_metrics.append(m)

    usable_pfs = [m.get("profit_factor") for m in fold_metrics
                  if m.get("trades_total", 0) >= min_trades_per_fold and m.get("profit_factor") is not None]
    valid_folds = len(usable_pfs)
    profitable_folds = sum(1 for pf in usable_pfs if pf > 1.0)
    pct_folds_profitable = round(profitable_folds / valid_folds * 100, 1) if valid_folds else None
    avg_fold_pf = round(float(np.mean(usable_pfs)), 3) if usable_pfs else None
    min_fold_pf = round(float(np.min(usable_pfs)), 3) if usable_pfs else None

    robustness_score = None
    if valid_folds >= 3 and avg_fold_pf is not None:
        # rewards BOTH consistency (fraction of folds profitable) and
        # magnitude (avg PF, capped at 2.0 so one outlier fold can't dominate)
        robustness_score = round((pct_folds_profitable / 100) * min(avg_fold_pf, 2.0), 3)

    return {
        "n_folds": n_folds,
        "valid_folds": valid_folds,
        "pct_folds_profitable": pct_folds_profitable,
        "avg_fold_pf": avg_fold_pf,
        "min_fold_pf": min_fold_pf,
        "robustness_score": robustness_score,
    }
