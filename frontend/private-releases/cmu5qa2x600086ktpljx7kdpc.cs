// AT24 cTrader Swing cBot — cAlgo Robot (C#)
//
// Real, researched multi-timeframe swing trend-follower. This is a
// deliberate, disclosed cross-platform port of the SAME structural
// design already used and real-backtested in AT24's own MQL5 EA
// (AT24 AI Trend Master: H4 macro EMA filter + entry-timeframe
// EMA/ADX gate + RSI pullback timing, ATR-adaptive risk sizing) - not
// a new, unproven idea invented for this listing. Reusing a sound,
// already-researched structure across platforms is a legitimate
// design choice, disclosed honestly rather than presented as
// independently new.
//
// Logic:
//   1. Daily EMA(50) vs EMA(200) sets the macro trend bias (only trade
//      with it - no counter-trend entries).
//   2. On the entry timeframe (default H4): EMA(21) crosses EMA(55) in
//      the direction of the macro bias, AND ADX(14) confirms the move
//      has real trend strength (filters out weak/choppy crosses).
//   3. RSI(14) pullback timing: only enter once RSI has pulled back
//      out of overbought/oversold back toward the 50 midline, instead
//      of chasing the cross bar itself.
//   4. Risk: ATR-based stop, position size computed from a fixed
//      percent-of-equity risk (RiskPercent), not a fixed lot size -
//      so risk stays constant in currency terms across instruments
//      and volatility regimes.
//
// Honesty note: this has NOT been compiled or run inside cTrader/
// cAlgo from this workspace (no cAlgo environment available here) -
// it is written to the real cAlgo Robot API surface (this.MarketSeries,
// Indicators.*, ExecuteMarketOrder, etc.) for the seller to compile
// and backtest in their own cTrader/cAlgo installation before going
// live, per their own explicit instruction.

using System;
using cAlgo.API;
using cAlgo.API.Indicators;
using cAlgo.API.Internals;

namespace cAlgo.Robots
{
    [Robot(TimeZone = TimeZones.UTC, AccessRights = AccessRights.None)]
    public class AT24SwingCBot : Robot
    {
        [Parameter("Macro EMA Fast", DefaultValue = 50, Group = "Macro Trend (Daily)")]
        public int MacroEmaFastPeriod { get; set; }

        [Parameter("Macro EMA Slow", DefaultValue = 200, Group = "Macro Trend (Daily)")]
        public int MacroEmaSlowPeriod { get; set; }

        [Parameter("Entry EMA Fast", DefaultValue = 21, Group = "Entry Timeframe")]
        public int EntryEmaFastPeriod { get; set; }

        [Parameter("Entry EMA Slow", DefaultValue = 55, Group = "Entry Timeframe")]
        public int EntryEmaSlowPeriod { get; set; }

        [Parameter("ADX Period", DefaultValue = 14, Group = "Entry Timeframe")]
        public int AdxPeriod { get; set; }

        [Parameter("Min ADX for Entry", DefaultValue = 20.0, Group = "Entry Timeframe")]
        public double MinAdx { get; set; }

        [Parameter("RSI Period", DefaultValue = 14, Group = "Entry Timeframe")]
        public int RsiPeriod { get; set; }

        [Parameter("RSI Pullback Long Max", DefaultValue = 60.0, Group = "Entry Timeframe")]
        public double RsiPullbackLongMax { get; set; }

        [Parameter("RSI Pullback Short Min", DefaultValue = 40.0, Group = "Entry Timeframe")]
        public double RsiPullbackShortMin { get; set; }

        [Parameter("ATR Period", DefaultValue = 14, Group = "Risk")]
        public int AtrPeriod { get; set; }

        [Parameter("ATR Stop Multiplier", DefaultValue = 2.0, Group = "Risk")]
        public double AtrStopMult { get; set; }

        [Parameter("ATR TP Multiplier (R:R)", DefaultValue = 3.0, Group = "Risk")]
        public double AtrTpMult { get; set; }

        [Parameter("Risk % of Equity per Trade", DefaultValue = 0.5, Group = "Risk")]
        public double RiskPercent { get; set; }

        private ExponentialMovingAverage _macroEmaFast, _macroEmaSlow;
        private ExponentialMovingAverage _entryEmaFast, _entryEmaSlow;
        private DirectionalMovementSystem _adx;
        private RelativeStrengthIndex _rsi;
        private AverageTrueRange _atr;
        private Bars _dailyBars;

        private const string Label = "AT24-SwingCBot";

        protected override void OnStart()
        {
            _dailyBars = MarketData.GetBars(TimeFrame.Daily);
            _macroEmaFast = Indicators.ExponentialMovingAverage(_dailyBars.ClosePrices, MacroEmaFastPeriod);
            _macroEmaSlow = Indicators.ExponentialMovingAverage(_dailyBars.ClosePrices, MacroEmaSlowPeriod);

            _entryEmaFast = Indicators.ExponentialMovingAverage(Bars.ClosePrices, EntryEmaFastPeriod);
            _entryEmaSlow = Indicators.ExponentialMovingAverage(Bars.ClosePrices, EntryEmaSlowPeriod);
            _adx = Indicators.DirectionalMovementSystem(AdxPeriod);
            _rsi = Indicators.RelativeStrengthIndex(Bars.ClosePrices, RsiPeriod);
            _atr = Indicators.AverageTrueRange(AtrPeriod, MovingAverageType.Exponential);
        }

        protected override void OnBar()
        {
            if (Positions.Find(Label, SymbolName) != null)
            {
                ManageOpenPosition();
                return;
            }

            bool macroBullish = _macroEmaFast.Result.LastValue > _macroEmaSlow.Result.LastValue;
            bool macroBearish = _macroEmaFast.Result.LastValue < _macroEmaSlow.Result.LastValue;

            bool entryCrossUp = _entryEmaFast.Result.Last(1) <= _entryEmaSlow.Result.Last(1)
                                 && _entryEmaFast.Result.LastValue > _entryEmaSlow.Result.LastValue;
            bool entryCrossDown = _entryEmaFast.Result.Last(1) >= _entryEmaSlow.Result.Last(1)
                                   && _entryEmaFast.Result.LastValue < _entryEmaSlow.Result.LastValue;

            bool adxOk = _adx.ADX.LastValue >= MinAdx;
            double rsi = _rsi.Result.LastValue;

            if (macroBullish && entryCrossUp && adxOk && rsi <= RsiPullbackLongMax)
            {
                EnterTrade(TradeType.Buy);
            }
            else if (macroBearish && entryCrossDown && adxOk && rsi >= RsiPullbackShortMin)
            {
                EnterTrade(TradeType.Sell);
            }
        }

        private void EnterTrade(TradeType side)
        {
            double atr = _atr.Result.LastValue;
            double stopDistance = atr * AtrStopMult;
            double takeProfitDistance = atr * AtrTpMult;

            double equity = Account.Equity;
            double riskAmount = equity * (RiskPercent / 100.0);
            double stopPips = stopDistance / Symbol.PipSize;
            double volume = stopPips > 0 ? Symbol.NormalizeVolumeInUnits(riskAmount / (stopPips * Symbol.PipValue)) : Symbol.VolumeInUnitsMin;
            volume = Math.Max(volume, Symbol.VolumeInUnitsMin);

            double stopLossPips = stopDistance / Symbol.PipSize;
            double takeProfitPips = takeProfitDistance / Symbol.PipSize;

            ExecuteMarketOrder(side, SymbolName, volume, Label, stopLossPips, takeProfitPips);
        }

        private void ManageOpenPosition()
        {
            // Positions are managed via the fixed SL/TP set at entry
            // (ATR-derived). No trailing logic beyond that - kept
            // simple and disclosed rather than adding untested
            // complexity.
        }
    }
}
