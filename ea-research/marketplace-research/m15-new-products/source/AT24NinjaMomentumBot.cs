// AT24 Ninja Momentum Bot — NinjaScript Strategy (C#) for NinjaTrader 8
//
// Real, researched momentum strategy for futures: dual-confirmation
// momentum (RSI directional bias + MACD histogram turning in the same
// direction), traded only inside a configured session window - futures
// trade nearly 24 hours, and low-liquidity overnight/globex hours are
// a genuine, well-known source of poor fills and noisy false signals,
// so session control here is a real risk control, not decoration.
//
// Logic:
//   1. Session filter: only evaluate/enter between SessionStartTime and
//      SessionEndTime (default regular US futures session), and force-
//      flatten at SessionEndTime - no overnight exposure held.
//   2. Momentum bias: RSI(RsiPeriod) above RsiBullLevel = bullish bias,
//      below RsiBearLevel = bearish bias (a real directional filter,
//      not just an overbought/oversold oscillator read).
//   3. Trigger: MACD histogram (Macd - MacdAvg) crosses up through zero
//      while bias is bullish -> long; crosses down through zero while
//      bias is bearish -> short. Using the histogram cross (not the
//      raw MACD/signal cross) times entries closer to the actual
//      momentum inflection.
//   4. Risk: ATR-based stop and take-profit (configurable R:R), so
//      stop distance adapts to the instrument's real recent volatility
//      instead of a fixed tick count that would be wrong across
//      instruments (ES vs. NQ vs. CL all move very differently).
//
// Honesty note: this has NOT been compiled or run inside NinjaTrader
// from this workspace (no NinjaTrader environment available here) -
// it is written to the real NinjaScript Strategy API (OnBarUpdate,
// built-in RSI/MACD/ATR indicators, EnterLong/EnterShort,
// SetStopLoss/SetProfitTarget) for the seller to compile (F5 in
// NinjaScript Editor) and Strategy-Analyzer-backtest in their own
// NinjaTrader 8 installation before going live, per their own explicit
// instruction.

using System;
using NinjaTrader.Cbi;
using NinjaTrader.Data;
using NinjaTrader.NinjaScript;
using NinjaTrader.NinjaScript.Strategies;

namespace NinjaTrader.NinjaScript.Strategies
{
    public class AT24NinjaMomentumBot : Strategy
    {
        // ── Momentum inputs ─────────────────────────────────────
        [NinjaScriptProperty]
        public int RsiPeriod { get; set; } = 14;

        [NinjaScriptProperty]
        public double RsiBullLevel { get; set; } = 55.0;

        [NinjaScriptProperty]
        public double RsiBearLevel { get; set; } = 45.0;

        [NinjaScriptProperty]
        public int MacdFast { get; set; } = 12;

        [NinjaScriptProperty]
        public int MacdSlow { get; set; } = 26;

        [NinjaScriptProperty]
        public int MacdSmooth { get; set; } = 9;

        // ── Risk inputs ─────────────────────────────────────────
        [NinjaScriptProperty]
        public int AtrPeriod { get; set; } = 14;

        [NinjaScriptProperty]
        public double AtrStopMult { get; set; } = 1.5;

        [NinjaScriptProperty]
        public double AtrTpMult { get; set; } = 2.5;

        // ── Session control ──────────────────────────────────────
        [NinjaScriptProperty]
        public TimeSpan SessionStartTime { get; set; } = new TimeSpan(9, 30, 0);

        [NinjaScriptProperty]
        public TimeSpan SessionEndTime { get; set; } = new TimeSpan(15, 45, 0);

        private RSI rsi;
        private MACD macd;
        private ATR atr;

        protected override void OnStateChange()
        {
            if (State == State.SetDefaults)
            {
                Name = "AT24 Ninja Momentum Bot";
                Calculate = Calculate.OnBarClose;
                EntriesPerDirection = 1;
                EntryHandling = EntryHandling.AllEntries;
                IsExitOnSessionCloseStrategy = true;
                ExitOnSessionCloseSeconds = 30;
                IsUnmanaged = false;
            }
            else if (State == State.DataLoaded)
            {
                rsi = RSI(RsiPeriod, 1);
                macd = MACD(MacdFast, MacdSlow, MacdSmooth);
                atr = ATR(AtrPeriod);
            }
        }

        protected override void OnBarUpdate()
        {
            if (BarsInProgress != 0 || CurrentBar < Math.Max(MacdSlow, AtrPeriod) + MacdSmooth)
                return;

            TimeSpan now = Time[0].TimeOfDay;
            bool inSession = now >= SessionStartTime && now <= SessionEndTime;

            if (!inSession)
            {
                if (Position.MarketPosition != MarketPosition.Flat)
                    ExitAllPositions("Outside session window");
                return;
            }

            double macdHistNow = macd.Diff[0];
            double macdHistPrev = macd.Diff[1];
            double rsiNow = rsi.Value[0];

            bool bullBias = rsiNow >= RsiBullLevel;
            bool bearBias = rsiNow <= RsiBearLevel;

            bool histCrossUp = macdHistPrev <= 0 && macdHistNow > 0;
            bool histCrossDown = macdHistPrev >= 0 && macdHistNow < 0;

            double atrVal = atr[0];

            if (Position.MarketPosition == MarketPosition.Flat)
            {
                if (bullBias && histCrossUp)
                {
                    EnterLong("AT24-MomLong");
                    SetStopLoss("AT24-MomLong", CalculationMode.Price, Close[0] - atrVal * AtrStopMult, false);
                    SetProfitTarget("AT24-MomLong", CalculationMode.Price, Close[0] + atrVal * AtrTpMult);
                }
                else if (bearBias && histCrossDown)
                {
                    EnterShort("AT24-MomShort");
                    SetStopLoss("AT24-MomShort", CalculationMode.Price, Close[0] + atrVal * AtrStopMult, false);
                    SetProfitTarget("AT24-MomShort", CalculationMode.Price, Close[0] - atrVal * AtrTpMult);
                }
            }
        }

        private void ExitAllPositions(string reason)
        {
            if (Position.MarketPosition == MarketPosition.Long)
                ExitLong("SessionExit", "AT24-MomLong");
            else if (Position.MarketPosition == MarketPosition.Short)
                ExitShort("SessionExit", "AT24-MomShort");
        }
    }
}
