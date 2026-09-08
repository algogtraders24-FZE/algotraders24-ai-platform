import { validateMarketSeries } from "../../domain/market-series.js";
import { generateSignal, firstMatchingExitRule } from "../signal-generator.js";
import { evaluateRisk } from "../risk/pipeline.js";
import { computeTradingDayKey } from "../risk/daily-loss.js";
import { computeCanonicalHash } from "../determinism.js";
import { computeSemanticStrategyHash } from "../identity.js";
import { computeCoreMetrics } from "../../domain/metrics.js";
import { EventQueue } from "../simulation/event-queue.js";
import { createOrder, transitionOrder, isOrderExpired } from "../simulation/order-engine.js";
import { validateOrderModification } from "../../domain/simulation/order-modification.js";
import { applyOrderModification } from "../simulation/order-modification.js";
import { executableRules } from "../../domain/pending-order-management-policy.js";
import { evaluatePendingOrderManagementPolicy } from "../simulation/pending-order-management.js";
import { resolveMarketFill, resolveLimitFill, resolveStopFill, resolveStopLimitFill, resolveProtectiveExit } from "../simulation/bar-fill-model.js";
import { openPosition, increasePosition, reducePosition, closePosition, computeUnrealizedPnl } from "../simulation/position-engine.js";
import { createAccount, applyFill, markToMarket } from "../simulation/account-engine.js";
import { TradeLedger, buildTrade } from "../simulation/trade-ledger.js";
import { buildDecision } from "../simulation/decision-builder.js";
import { resolveStopLossPrice, resolveTakeProfitPrice, resolvePositionSize } from "../simulation/rule-resolvers.js";
import { mapRiskAction } from "../simulation/risk-action-mapping.js";
import { runSimulation } from "../simulation/simulation-engine.js";
import { resolvePriceReference } from "../strategy-ir/price-reference-resolver.js";
import { parentBarIdentity } from "./parent-bar-identity.js";
import { reconstructIntrabarSequence, observationToBar } from "./bar-magnifier.js";
const RUNTIME_VERSION = "0.1.0";
function mapWith(map, key, value) {
    const next = new Map(map);
    next.set(key, value);
    return next;
}
function mapWithout(map, key) {
    const next = new Map(map);
    next.delete(key);
    return next;
}
function setWith(set, value) {
    const next = new Set(set);
    next.add(value);
    return next;
}
function buildIndicatorMap(series, index) {
    const map = new Map();
    for (const [key, values] of series) {
        const value = values[index];
        if (value !== undefined)
            map.set(key, value);
    }
    return map;
}
function createInitialState(initialBalance, asOf) {
    return {
        clock: asOf,
        account: createAccount(initialBalance, asOf),
        openPositions: new Map(),
        pendingOrders: new Map(),
        ledger: [],
        entryBarIndexByPosition: new Map(),
        partialCloseTriggered: new Set(),
        tradingDayKey: computeTradingDayKey(asOf, 0),
        realizedPnlToday: 0,
        equityAtDayStart: initialBalance,
        orderCreationBarIndex: new Map(),
        entryCountByPosition: new Map(),
    };
}
/**
 * Q0.6 — D2/D3 multi-fidelity simulation. This orchestrator NECESSARILY
 * duplicates the outer control-flow shape of Q0.5's runSimulation()
 * (event-queue-driven, one-bar-at-a-time seeding, same 8-step pipeline)
 * because Q0.5's file is FROZEN and is never modified or made pluggable
 * — see docs/Q0.6_D2_D3_EXECUTION.md's Known Limitations for why this
 * tradeoff was made deliberately rather than refactoring the frozen
 * file. What is NOT duplicated is any FILL or PROTECTIVE-EXIT decision
 * rule: every child-bar resolution below calls Q0.5's OWN
 * resolveMarketFill/resolveLimitFill/resolveStopFill/
 * resolveStopLimitFill/resolveProtectiveExit, just once per available
 * child bar instead of once per parent bar (Q0.6.6/7/9's "shared
 * infrastructure, no duplicated business logic" instruction).
 *
 * Only D2_LOWER_TIMEFRAME / D3_M1 are handled here. D1_OHLC is handled
 * by runMultiFidelitySimulation() delegating directly to Q0.5's
 * unmodified runSimulation() — see multi-fidelity-engine.ts's exported
 * entry point below this function.
 */
function runFidelityAwareSimulation(bars, config) {
    const base = config.base;
    const detailProvider = config.detailProvider;
    const detailTimeframe = config.detailTimeframe;
    if (!detailProvider || !detailTimeframe) {
        throw new Error(`runFidelityAwareSimulation: fidelity "${config.fidelity}" requires both detailProvider and detailTimeframe`);
    }
    if (config.fidelity !== "D2_LOWER_TIMEFRAME" && config.fidelity !== "D3_M1") {
        throw new Error(`runFidelityAwareSimulation: unrecognized fidelity "${config.fidelity}" — only "D2_LOWER_TIMEFRAME" and "D3_M1" are implemented (D4-D7 are reserved, not selectable)`);
    }
    const missingDetailPolicy = config.missingDetailPolicy ?? "FAIL";
    const seriesCheck = validateMarketSeries({ instrument: base.instrument, timeframe: base.timeframe, bars });
    if (!seriesCheck.valid) {
        throw new Error(`runFidelityAwareSimulation: invalid market series: ${seriesCheck.errors.join("; ")}`);
    }
    const symbol = base.instrument.symbol;
    const strategyHash = computeSemanticStrategyHash(base.strategySpec);
    const queue = new EventQueue();
    const eventCounts = {};
    const executionStats = { ordersCreated: 0, ordersFilled: 0, ordersRejected: 0, ordersCancelled: 0, ordersExpired: 0 };
    const ledger = new TradeLedger();
    let totalParents = 0;
    let completeParents = 0;
    let partialParents = 0;
    let missingParents = 0;
    let parentsResolvedAtParentGranularity = 0;
    let ambiguousResolutionCount = 0;
    function record(eventType, timestamp, payload) {
        const evt = queue.enqueue({ timestamp, eventType, source: "MultiFidelitySimulationEngine", payload });
        eventCounts[evt.eventType] = (eventCounts[evt.eventType] ?? 0) + 1;
        return evt;
    }
    if (bars.length > 0) {
        queue.enqueue({ timestamp: bars[0].timestamp, eventType: "MARKET_BAR", source: "MultiFidelitySimulationEngine", payload: { bar: bars[0], barIndex: 0 } });
    }
    function applyRealizedTrade(state, position, exitPrice, exitQuantity, grossPnl, fee, timestamp) {
        const account = applyFill(state.account, grossPnl, fee, timestamp);
        const trade = buildTrade({
            tradeId: `${position.id}:${timestamp}:${state.ledger.length}`,
            strategyVersion: base.strategySpec.version,
            position,
            exitPrice,
            exitTimestamp: timestamp,
            quantity: exitQuantity,
            grossPnl,
            fees: fee,
            fillModel: "BarMagnifierFillModel",
            spreadModel: base.spreadModel.name,
            slippageModel: base.slippageModel.name,
            feeModel: base.feeModel.name,
        });
        ledger.record(trade);
        return { ...state, account, ledger: ledger.all(), realizedPnlToday: state.realizedPnlToday + grossPnl - fee };
    }
    let state = createInitialState(base.initialBalance, bars.length > 0 ? bars[0].timestamp : 0);
    let event = queue.dequeue();
    while (event !== undefined) {
        if (event.eventType !== "MARKET_BAR") {
            event = queue.dequeue();
            continue;
        }
        eventCounts.MARKET_BAR = (eventCounts.MARKET_BAR ?? 0) + 1;
        const { bar, barIndex } = event.payload;
        state = { ...state, clock: bar.timestamp };
        // --- Resolve this parent bar's child sequence (Q0.6.2/6/10/11) ---
        totalParents += 1;
        const parent = parentBarIdentity(bar);
        const detailResult = detailProvider.getDetail({ parent, childTimeframe: detailTimeframe });
        const sequence = reconstructIntrabarSequence(parent, base.instrument, detailTimeframe, detailResult);
        let childBars;
        if (sequence.coverage === "MISSING") {
            missingParents += 1;
            if (missingDetailPolicy === "FALLBACK_TO_D1") {
                parentsResolvedAtParentGranularity += 1;
                childBars = [bar];
            }
            else {
                throw new Error(`runFidelityAwareSimulation: INSUFFICIENT_DETAIL_DATA for parent bar at ${bar.timestamp} (symbol ${symbol}) — no "${detailTimeframe}" child bars available and missingDetailPolicy is not FALLBACK_TO_D1`);
            }
        }
        else {
            if (sequence.coverage === "COMPLETE")
                completeParents += 1;
            else
                partialParents += 1;
            childBars = sequence.observations.map((obs) => observationToBar(obs, base.instrument, detailTimeframe));
        }
        // --- Step 0.4 (Q0.13): evaluate any compiled PendingOrderManagementPolicy — mirrors
        // simulation-engine.ts's identical addition exactly (Q0.6's own established "duplicate
        // control flow, reuse frozen functions" architecture — the D1/D2/D3 mirror discipline
        // applied PROACTIVELY here, unlike Q0.11's own discovery-by-failing-test). Evaluated once per
        // PARENT bar, before any child-bar walking, matching Step 0.5's own atBarIndex granularity. ---
        if (base.pendingOrderManagementPolicy) {
            const executable = executableRules(base.pendingOrderManagementPolicy);
            if (executable.length > 0) {
                const atrForPolicy = base.atrByIndex?.[barIndex];
                for (const [orderId, order] of state.pendingOrders) {
                    if (order.instrument.symbol !== symbol)
                        continue;
                    if (order.creationTimestamp >= bar.timestamp)
                        continue;
                    const intent = evaluatePendingOrderManagementPolicy({ rules: executable }, order, bar, "pending-order management policy", atrForPolicy);
                    if (!intent)
                        continue;
                    const validation = validateOrderModification(order, intent, bar.close);
                    if (!validation.valid) {
                        record("ORDER_MODIFICATION_REJECTED", bar.timestamp, { orderId, errors: validation.errors });
                        continue;
                    }
                    const outcome = applyOrderModification(order, intent, bar.timestamp);
                    if (outcome.kind === "CANCELLED") {
                        state = { ...state, pendingOrders: mapWithout(state.pendingOrders, orderId) };
                        record("ORDER_CANCELLED", bar.timestamp, { orderId, reason: intent.reason });
                        executionStats.ordersCancelled += 1;
                    }
                    else if (outcome.kind === "MODIFIED") {
                        state = { ...state, pendingOrders: mapWith(state.pendingOrders, orderId, outcome.order) };
                        record("ORDER_MODIFIED", bar.timestamp, { orderId, modificationType: intent.modificationType });
                    }
                }
            }
        }
        // --- Step 0.5 (Q0.12): apply any scheduled order modifications for THIS parent bar — mirrors simulation-engine.ts's identical addition exactly (Q0.6's own established "duplicate control flow, reuse frozen functions" architecture; a real gap in Q0.11 when this mirror was missed). Evaluated once per PARENT bar, before any child-bar walking, matching the schedule's own atBarIndex granularity. ---
        for (const mod of base.orderModifications ?? []) {
            if (mod.atBarIndex !== barIndex)
                continue;
            const target = state.pendingOrders.get(mod.intent.orderId);
            if (target && target.instrument.symbol !== symbol)
                continue; // a different instrument's order — not an error, simply not this loop's concern
            // Q0.12.19 — a MISSING order (already filled/cancelled/expired and thus no longer in pendingOrders, or never existed) is validated and
            // explicitly REJECTED here, never silently skipped — `validateOrderModification` handles `target === undefined` itself.
            const validation = validateOrderModification(target, mod.intent, bar.close);
            if (!validation.valid || !target) {
                record("ORDER_MODIFICATION_REJECTED", bar.timestamp, { orderId: mod.intent.orderId, errors: validation.errors });
                continue;
            }
            const outcome = applyOrderModification(target, mod.intent, bar.timestamp);
            if (outcome.kind === "CANCELLED") {
                state = { ...state, pendingOrders: mapWithout(state.pendingOrders, target.orderId) };
                record("ORDER_CANCELLED", bar.timestamp, { orderId: target.orderId, reason: mod.intent.reason });
                executionStats.ordersCancelled += 1;
            }
            else if (outcome.kind === "MODIFIED") {
                state = { ...state, pendingOrders: mapWith(state.pendingOrders, target.orderId, outcome.order) };
                record("ORDER_MODIFIED", bar.timestamp, { orderId: target.orderId, modificationType: mod.intent.modificationType });
            }
            else {
                state = { ...state, pendingOrders: mapWithout(state.pendingOrders, outcome.cancelledOrder.orderId) };
                record("ORDER_CANCELLED", bar.timestamp, { orderId: outcome.cancelledOrder.orderId, reason: outcome.cancelledOrder.terminalReason });
                executionStats.ordersCancelled += 1;
                const createdEvt = record("ORDER_CREATED", bar.timestamp, {});
                const newOrder = createOrder(outcome.newOrderInput, createdEvt.sequence);
                const submitted = transitionOrder(transitionOrder(newOrder, "SUBMITTED"), "ACCEPTED");
                record("ORDER_SUBMITTED", bar.timestamp, { orderId: submitted.orderId });
                record("ORDER_ACCEPTED", bar.timestamp, { orderId: submitted.orderId });
                state = {
                    ...state,
                    pendingOrders: mapWith(state.pendingOrders, submitted.orderId, submitted),
                    orderCreationBarIndex: mapWith(state.orderCreationBarIndex, submitted.orderId, barIndex),
                };
                executionStats.ordersCreated += 1;
                record("ORDER_REPLACED", bar.timestamp, { oldOrderId: outcome.cancelledOrder.orderId, newOrderId: submitted.orderId });
            }
        }
        // --- Steps 1 & 1b, interleaved per child bar (Q0.6.21/22 same-bar entry+exit ordering) ---
        for (const childBar of childBars) {
            // Step 1: resolve pending orders against this child bar
            for (const [orderId, order] of state.pendingOrders) {
                if (order.instrument.symbol !== symbol)
                    continue;
                if (order.creationTimestamp >= childBar.timestamp)
                    continue; // same-bar safety guard (parent-level, preserved at child granularity)
                // Q0.12.21 — expiration checked BEFORE fill resolution, at child-bar granularity, mirroring simulation-engine.ts exactly.
                const creationBarIndex = state.orderCreationBarIndex.get(orderId) ?? barIndex;
                if (isOrderExpired(order, {
                    asOf: childBar.timestamp,
                    currentBarIndex: barIndex,
                    creationBarIndex,
                    ...(base.dayBoundaryOffsetMinutes !== undefined ? { dayBoundaryOffsetMinutes: base.dayBoundaryOffsetMinutes } : {}),
                })) {
                    transitionOrder(order, "EXPIRED", { terminalReason: "expiration policy reached" });
                    state = { ...state, pendingOrders: mapWithout(state.pendingOrders, orderId) };
                    record("ORDER_EXPIRED", childBar.timestamp, { orderId });
                    executionStats.ordersExpired += 1;
                    continue;
                }
                let outcome;
                if (order.orderType === "MARKET")
                    outcome = resolveMarketFill(order, childBar, base.spreadModel, base.slippageModel);
                else if (order.orderType === "LIMIT")
                    outcome = resolveLimitFill(order, childBar);
                else if (order.orderType === "STOP")
                    outcome = resolveStopFill(order, childBar);
                else
                    outcome = order.status === "TRIGGERED" ? resolveLimitFill(order, childBar) : resolveStopLimitFill(order, childBar);
                if (outcome.filled) {
                    const fillPrice = outcome.fillPrice;
                    const fee = base.feeModel.computeFee({ quantity: order.quantity, notional: fillPrice * order.quantity });
                    const filledOrder = transitionOrder(order, "FILLED", { filledQuantity: order.quantity, averageFillPrice: fillPrice });
                    state = { ...state, pendingOrders: mapWithout(state.pendingOrders, orderId) };
                    record("ORDER_FILLED", childBar.timestamp, { orderId, fillPrice });
                    executionStats.ordersFilled += 1;
                    const existing = state.openPositions.get(symbol);
                    if (!existing) {
                        const position = openPosition({
                            id: filledOrder.orderId,
                            originatingOrderIntentId: filledOrder.orderId,
                            instrument: order.instrument,
                            side: order.side,
                            quantity: order.quantity,
                            entryPrice: fillPrice,
                            entryTimestamp: childBar.timestamp,
                            ...(order.attachedStopLoss !== undefined ? { stopLoss: order.attachedStopLoss } : {}),
                            ...(order.attachedTakeProfit !== undefined ? { takeProfit: order.attachedTakeProfit } : {}),
                            fee,
                        });
                        state = {
                            ...state,
                            openPositions: mapWith(state.openPositions, symbol, position),
                            entryBarIndexByPosition: mapWith(state.entryBarIndexByPosition, position.id, barIndex),
                            entryCountByPosition: mapWith(state.entryCountByPosition, position.id, 1),
                        };
                        record("POSITION_OPENED", childBar.timestamp, { positionId: position.id });
                    }
                    else if (existing.side === order.side) {
                        const updated = increasePosition(existing, order.quantity, fillPrice, childBar.timestamp, fee);
                        state = {
                            ...state,
                            openPositions: mapWith(state.openPositions, symbol, updated),
                            entryCountByPosition: mapWith(state.entryCountByPosition, updated.id, (state.entryCountByPosition.get(existing.id) ?? 1) + 1),
                        };
                        record("POSITION_MODIFIED", childBar.timestamp, { positionId: updated.id });
                    }
                    else {
                        const reduceQty = Math.min(order.quantity, existing.quantity);
                        const { position: reduced, grossPnl } = reducePosition(existing, reduceQty, fillPrice, childBar.timestamp, fee);
                        state = applyRealizedTrade(state, existing, fillPrice, reduceQty, grossPnl, fee, childBar.timestamp);
                        record(reduced.status === "CLOSED" ? "POSITION_CLOSED" : "POSITION_REDUCED", childBar.timestamp, { positionId: reduced.id });
                        if (reduced.status === "CLOSED")
                            state = { ...state, entryCountByPosition: mapWithout(state.entryCountByPosition, existing.id) };
                        const leftover = order.quantity - reduceQty;
                        if (leftover > 0 && reduced.status === "CLOSED") {
                            const reversal = openPosition({
                                id: `${filledOrder.orderId}:reversal`,
                                originatingOrderIntentId: filledOrder.orderId,
                                instrument: order.instrument,
                                side: order.side,
                                quantity: leftover,
                                entryPrice: fillPrice,
                                entryTimestamp: childBar.timestamp,
                                ...(order.attachedStopLoss !== undefined ? { stopLoss: order.attachedStopLoss } : {}),
                                ...(order.attachedTakeProfit !== undefined ? { takeProfit: order.attachedTakeProfit } : {}),
                                fee: 0,
                            });
                            state = {
                                ...state,
                                openPositions: mapWith(state.openPositions, symbol, reversal),
                                entryBarIndexByPosition: mapWith(state.entryBarIndexByPosition, reversal.id, barIndex),
                                entryCountByPosition: mapWith(state.entryCountByPosition, reversal.id, 1),
                            };
                            record("POSITION_OPENED", childBar.timestamp, { positionId: reversal.id });
                        }
                        else {
                            state = { ...state, openPositions: reduced.status === "CLOSED" ? mapWithout(state.openPositions, symbol) : mapWith(state.openPositions, symbol, reduced) };
                        }
                    }
                }
                else if (outcome.triggeredOnly) {
                    const triggered = transitionOrder(order, "TRIGGERED");
                    state = { ...state, pendingOrders: mapWith(state.pendingOrders, orderId, triggered) };
                    record("ORDER_TRIGGERED", childBar.timestamp, { orderId });
                }
            }
            // Step 1b: check the open position's own protective SL/TP against this child bar
            const positionForProtectiveCheck = state.openPositions.get(symbol);
            if (positionForProtectiveCheck) {
                const exit = resolveProtectiveExit(positionForProtectiveCheck.side, positionForProtectiveCheck.stopLoss, positionForProtectiveCheck.takeProfit, childBar);
                if (exit.exited) {
                    if (exit.ambiguous)
                        ambiguousResolutionCount += 1;
                    const fee = base.feeModel.computeFee({ quantity: positionForProtectiveCheck.quantity, notional: exit.exitPrice * positionForProtectiveCheck.quantity });
                    const { position: closed, grossPnl } = closePosition(positionForProtectiveCheck, exit.exitPrice, childBar.timestamp, fee);
                    state = applyRealizedTrade(state, positionForProtectiveCheck, exit.exitPrice, positionForProtectiveCheck.quantity, grossPnl, fee, childBar.timestamp);
                    state = { ...state, openPositions: mapWithout(state.openPositions, symbol), entryCountByPosition: mapWithout(state.entryCountByPosition, closed.id) };
                    record("POSITION_CLOSED", childBar.timestamp, { positionId: closed.id, reason: exit.reason, ambiguous: exit.ambiguous ?? false });
                }
            }
        }
        // --- Step 1c (Q1.5.3): SIGNAL_EXIT, PARENT bar only — mirrors D1's
        // identical placement exactly (evaluated once per parent bar, same
        // granularity as entry-signal generation below, never per intrabar
        // child observation — SIGNAL_EXIT is a condition over the strategy's
        // OWN timeframe/indicators, exactly like entry conditions, not an
        // intrabar price-level trigger like protective SL/TP above). Built
        // BEFORE Step 4 so a same-bar exit-then-entry is visible to Step 4,
        // exactly mirroring Step 1b's own established precedent.
        const indicatorValues = buildIndicatorMap(base.indicatorSeries, barIndex);
        const previousIndicatorValues = barIndex > 0 ? buildIndicatorMap(base.indicatorSeries, barIndex - 1) : undefined;
        const marketState = {
            instrument: base.instrument,
            timeframe: base.timeframe,
            asOf: bar.timestamp,
            bars: bars.slice(0, barIndex + 1),
            indicatorValues,
            ...(previousIndicatorValues !== undefined ? { previousIndicatorValues } : {}),
        };
        const positionForSignalExit = state.openPositions.get(symbol);
        if (positionForSignalExit && base.strategySpec.exitRules.length > 0) {
            const matchedExit = firstMatchingExitRule(base.strategySpec.exitRules, positionForSignalExit.side, marketState);
            if (matchedExit) {
                const fee = base.feeModel.computeFee({ quantity: positionForSignalExit.quantity, notional: bar.close * positionForSignalExit.quantity });
                const { position: closed, grossPnl } = closePosition(positionForSignalExit, bar.close, bar.timestamp, fee);
                state = applyRealizedTrade(state, positionForSignalExit, bar.close, positionForSignalExit.quantity, grossPnl, fee, bar.timestamp);
                state = { ...state, openPositions: mapWithout(state.openPositions, symbol), entryCountByPosition: mapWithout(state.entryCountByPosition, closed.id) };
                record("POSITION_CLOSED", bar.timestamp, { positionId: closed.id, reason: `SIGNAL_EXIT rule "${matchedExit.id}"` });
            }
        }
        // --- Step 2: mark to market (against the PARENT bar's close, same timing as D1) ---
        const posNow = state.openPositions.get(symbol);
        const unrealized = posNow ? computeUnrealizedPnl(posNow, bar.close) : 0;
        if (unrealized !== state.account.unrealizedPnl) {
            state = { ...state, account: markToMarket(state.account, unrealized, bar.timestamp) };
        }
        // --- Step 3: day-boundary tracking ---
        const dayKey = computeTradingDayKey(bar.timestamp, base.dayBoundaryOffsetMinutes ?? 0);
        if (dayKey !== state.tradingDayKey) {
            state = { ...state, tradingDayKey: dayKey, realizedPnlToday: 0, equityAtDayStart: state.account.equity };
        }
        // --- Step 4: strategy calculation (ON_BAR_CLOSE, PARENT bar only — unchanged from D1) ---
        const signal = generateSignal(base.strategySpec, marketState);
        const currentPosition = state.openPositions.get(symbol);
        const pyramidingAdmission = base.strategySpec.pyramiding
            ? {
                allowPyramiding: base.strategySpec.pyramiding.allowPyramiding,
                ...(base.strategySpec.pyramiding.maxEntries !== undefined ? { maxEntries: base.strategySpec.pyramiding.maxEntries } : {}),
                currentEntryCount: currentPosition ? (state.entryCountByPosition.get(currentPosition.id) ?? 0) : 0,
                ...(currentPosition ? { openPositionSide: currentPosition.side } : {}),
            }
            : undefined;
        const hasPendingOrderForSymbol = [...state.pendingOrders.values()].some((o) => o.instrument.symbol === symbol);
        const decision = buildDecision(signal, currentPosition !== undefined, hasPendingOrderForSymbol, pyramidingAdmission);
        record("STRATEGY_CALCULATED", bar.timestamp, { strategyHash, signal, decision });
        // --- Step 5: risk evaluation (PARENT bar only — unchanged from D1) ---
        const atrValue = base.atrByIndex?.[barIndex];
        let riskInput;
        if (currentPosition) {
            riskInput = {
                asOf: bar.timestamp,
                riskSpecification: base.strategySpec.risk,
                instrument: base.instrument,
                direction: currentPosition.side,
                existingPosition: {
                    quantity: currentPosition.quantity,
                    entryPrice: currentPosition.entryPrice,
                    entryTimestamp: currentPosition.entryTimestamp,
                    currentPrice: bar.close,
                    ...(currentPosition.stopLoss !== undefined ? { currentStopLoss: currentPosition.stopLoss } : {}),
                    ...(atrValue !== undefined ? { currentAtr: atrValue } : {}),
                    barsHeld: barIndex - (state.entryBarIndexByPosition.get(currentPosition.id) ?? barIndex),
                    partialCloseAlreadyTriggered: state.partialCloseTriggered.has(currentPosition.id),
                },
                portfolio: { openPositionCount: state.openPositions.size },
                dailyLoss: { realizedPnlToday: state.realizedPnlToday, equityAtDayStart: state.equityAtDayStart },
            };
        }
        // Q1.5.4 — a SEPARATE, independent entry evaluation, mirroring
        // simulation-engine.ts's identical Step 5 restructuring exactly (Q0.6's
        // own established pattern: duplicate outer control-flow shape, reuse
        // frozen inner functions directly). Covers BOTH the pre-Q1.5 "flat, no
        // position" case AND the new pyramid-entry case.
        let entryRiskInput;
        if (decision.action === "ENTER") {
            const direction = signal.direction;
            // Q0.11 — mirrors simulation-engine.ts's identical Step 5 addition exactly
            // (Q0.6's own established pattern: duplicate outer control-flow shape,
            // reuse frozen inner functions directly — this file has always had its
            // OWN copy of Step 4/5, never called simulation-engine.ts's internals).
            // Omitting this mirror would have left D2/D3 silently treating every
            // entry as MARKET regardless of the declared executionType — a real gap
            // this sprint's own D1/D2 compatibility test caught.
            const matchedRule = base.strategySpec.entryRules.find((r) => r.id === signal.triggeredByRuleId);
            const orderType = matchedRule?.executionType;
            const limitPrice = matchedRule?.limitPrice !== undefined ? resolvePriceReference(matchedRule.limitPrice, marketState) : undefined;
            const stopPrice = matchedRule?.stopPrice !== undefined ? resolvePriceReference(matchedRule.stopPrice, marketState) : undefined;
            const riskReferencePrice = limitPrice ?? stopPrice ?? bar.close;
            const stopLossPrice = resolveStopLossPrice(base.strategySpec.risk.stopLoss, direction, riskReferencePrice, atrValue);
            const takeProfitPrice = resolveTakeProfitPrice(base.strategySpec.risk.takeProfit, direction, riskReferencePrice, stopLossPrice);
            const quantity = resolvePositionSize(base.strategySpec.risk.sizing, {
                entryPrice: riskReferencePrice,
                ...(stopLossPrice !== undefined ? { stopLossPrice } : {}),
                equity: state.account.equity,
            });
            entryRiskInput = {
                asOf: bar.timestamp,
                riskSpecification: base.strategySpec.risk,
                instrument: base.instrument,
                direction,
                proposedEntry: {
                    quantity,
                    entryPrice: riskReferencePrice,
                    ...(stopLossPrice !== undefined ? { stopLoss: stopLossPrice } : {}),
                    ...(takeProfitPrice !== undefined ? { takeProfit: takeProfitPrice } : {}),
                    ...(orderType !== undefined ? { orderType } : {}),
                    ...(limitPrice !== undefined ? { limitPrice } : {}),
                    ...(stopPrice !== undefined ? { stopPrice } : {}),
                },
                portfolio: { openPositionCount: state.openPositions.size },
                dailyLoss: { realizedPnlToday: state.realizedPnlToday, equityAtDayStart: state.equityAtDayStart },
            };
        }
        // Q1.5.4 — see simulation-engine.ts's identical `processRiskInput` for
        // the full rationale; extracted so management (`riskInput`) and entry
        // (`entryRiskInput`) apply through IDENTICAL handling code.
        function processRiskInput(input) {
            const riskResult = evaluateRisk(input);
            const mapping = mapRiskAction(riskResult.action);
            if (mapping.kind === "CREATE_ENTRY_ORDER") {
                const entry = input.proposedEntry;
                const createdEvt = record("ORDER_CREATED", bar.timestamp, {});
                const order = createOrder({
                    strategyVersion: base.strategySpec.version,
                    instrument: base.instrument,
                    side: input.direction,
                    quantity: entry.quantity,
                    orderType: mapping.orderType,
                    ...(mapping.limitPrice !== undefined ? { limitPrice: mapping.limitPrice } : {}),
                    ...(mapping.stopPrice !== undefined ? { stopPrice: mapping.stopPrice } : {}),
                    ...(entry.stopLoss !== undefined ? { attachedStopLoss: entry.stopLoss } : {}),
                    ...(entry.takeProfit !== undefined ? { attachedTakeProfit: entry.takeProfit } : {}),
                    creationTimestamp: bar.timestamp,
                }, createdEvt.sequence);
                executionStats.ordersCreated += 1;
                const submitted = transitionOrder(transitionOrder(order, "SUBMITTED"), "ACCEPTED");
                record("ORDER_SUBMITTED", bar.timestamp, { orderId: submitted.orderId });
                record("ORDER_ACCEPTED", bar.timestamp, { orderId: submitted.orderId });
                state = {
                    ...state,
                    pendingOrders: mapWith(state.pendingOrders, submitted.orderId, submitted),
                    orderCreationBarIndex: mapWith(state.orderCreationBarIndex, submitted.orderId, barIndex),
                };
            }
            else if (mapping.kind === "MODIFY_STOP" && currentPosition) {
                const modified = { ...currentPosition, stopLoss: mapping.newStopPrice, lastModifiedTimestamp: bar.timestamp };
                state = { ...state, openPositions: mapWith(state.openPositions, symbol, modified) };
                record("POSITION_MODIFIED", bar.timestamp, { positionId: modified.id, newStopPrice: mapping.newStopPrice });
            }
            else if (mapping.kind === "REDUCE_POSITION" && currentPosition) {
                const reduceQty = currentPosition.quantity * (mapping.closePercent / 100);
                const fee = base.feeModel.computeFee({ quantity: reduceQty, notional: bar.close * reduceQty });
                const { position: reduced, grossPnl } = reducePosition(currentPosition, reduceQty, bar.close, bar.timestamp, fee);
                state = applyRealizedTrade(state, currentPosition, bar.close, reduceQty, grossPnl, fee, bar.timestamp);
                state = { ...state, partialCloseTriggered: setWith(state.partialCloseTriggered, currentPosition.id) };
                state = {
                    ...state,
                    openPositions: reduced.status === "CLOSED" ? mapWithout(state.openPositions, symbol) : mapWith(state.openPositions, symbol, reduced),
                    ...(reduced.status === "CLOSED" ? { entryCountByPosition: mapWithout(state.entryCountByPosition, currentPosition.id) } : {}),
                };
                record(reduced.status === "CLOSED" ? "POSITION_CLOSED" : "POSITION_REDUCED", bar.timestamp, { positionId: reduced.id });
            }
            else if (mapping.kind === "FORCE_EXIT" && currentPosition) {
                const fee = base.feeModel.computeFee({ quantity: currentPosition.quantity, notional: bar.close * currentPosition.quantity });
                const { position: closed, grossPnl } = closePosition(currentPosition, bar.close, bar.timestamp, fee);
                state = applyRealizedTrade(state, currentPosition, bar.close, currentPosition.quantity, grossPnl, fee, bar.timestamp);
                state = { ...state, openPositions: mapWithout(state.openPositions, symbol), entryCountByPosition: mapWithout(state.entryCountByPosition, closed.id) };
                record("POSITION_CLOSED", bar.timestamp, { positionId: closed.id });
            }
        }
        if (riskInput)
            processRiskInput(riskInput);
        if (entryRiskInput)
            processRiskInput(entryRiskInput);
        if (barIndex + 1 < bars.length) {
            const nextBar = bars[barIndex + 1];
            queue.enqueue({ timestamp: nextBar.timestamp, eventType: "MARKET_BAR", source: "MultiFidelitySimulationEngine", payload: { bar: nextBar, barIndex: barIndex + 1 } });
        }
        event = queue.dequeue();
    }
    for (const [orderId, order] of state.pendingOrders) {
        transitionOrder(order, "EXPIRED", { terminalReason: "simulation ended with no further bars" });
        state = { ...state, pendingOrders: mapWithout(state.pendingOrders, orderId) };
        executionStats.ordersExpired += 1;
    }
    const eventStatistics = { totalEvents: Object.values(eventCounts).reduce((a, b) => a + b, 0), eventsByType: { ...eventCounts } };
    const executionStatistics = { ...executionStats };
    const detailCoverage = {
        totalParents,
        completeParents,
        partialParents,
        missingParents,
        completeRatio: totalParents === 0 ? 1 : completeParents / totalParents,
    };
    const fidelityQuality = {
        requestedFidelity: config.fidelity,
        detailCoverage,
        ambiguousResolutionCount,
        parentsResolvedAtParentGranularity,
    };
    const provenance = {
        strategyHash,
        strategyVersion: base.strategySpec.version,
        datasetId: base.datasetId,
        datasetVersion: base.datasetVersion,
        dataFidelity: base.dataFidelity,
        executionModel: "MultiFidelitySimulationEngine-v1",
        fillModel: "BarMagnifierFillModel",
        spreadModel: base.spreadModel.name,
        slippageModel: base.slippageModel.name,
        feeModel: base.feeModel.name,
        latencyModel: base.latencyModel.name,
        initialBalance: base.initialBalance,
        positionAccountingMode: "NETTING",
        runtimeVersion: RUNTIME_VERSION,
        simulationFidelity: config.fidelity,
        parentTimeframe: base.timeframe,
        detailTimeframe,
        detailProviderIdentity: detailProvider.providerId,
        detailCoverage,
        fidelityQuality,
    };
    const trades = ledger.all();
    const coreMetrics = computeCoreMetrics(trades.map((t) => ({ pnl: t.netPnl })), base.initialBalance);
    const rValues = trades.map((t) => t.rMultiple).filter((r) => r !== null);
    const averageR = rValues.length > 0 ? rValues.reduce((a, b) => a + b, 0) / rValues.length : null;
    const totalFees = trades.reduce((sum, t) => sum + t.fees, 0);
    const metrics = { ...coreMetrics, averageR, totalFees };
    const resultWithoutHash = {
        finalAccount: state.account,
        finalPositions: [...state.openPositions.values()],
        tradeLedger: trades,
        eventStatistics,
        executionStatistics,
        provenance,
        metrics,
    };
    return { ...resultWithoutHash, resultHash: computeCanonicalHash(resultWithoutHash) };
}
/**
 * Q0.6's single public entry point. `fidelity: "D1_OHLC"` delegates
 * DIRECTLY to Q0.5's unmodified runSimulation() (docs/Q0.6_MULTI_FIDELITY.md
 * — this is what guarantees Q0.6.31's D1-regression requirement: the
 * underlying trade prices/timestamps/P&L are produced by the EXACT SAME
 * function Q0.5 shipped, byte-for-byte, only the provenance wrapper
 * differs). `"D2_LOWER_TIMEFRAME"`/`"D3_M1"` run the new child-bar-aware
 * engine above.
 */
export function runMultiFidelitySimulation(bars, config) {
    if (config.fidelity === "D1_OHLC") {
        const baseResult = runSimulation(bars, config.base);
        const detailCoverage = { totalParents: bars.length, completeParents: bars.length, partialParents: 0, missingParents: 0, completeRatio: 1 };
        const fidelityQuality = { requestedFidelity: "D1_OHLC", detailCoverage, ambiguousResolutionCount: 0, parentsResolvedAtParentGranularity: 0 };
        const provenance = {
            ...baseResult.provenance,
            simulationFidelity: "D1_OHLC",
            parentTimeframe: config.base.timeframe,
            detailCoverage,
            fidelityQuality,
        };
        const { resultHash: _staleHash, ...baseWithoutHash } = baseResult;
        void _staleHash;
        const resultWithoutHash = { ...baseWithoutHash, provenance };
        return { ...resultWithoutHash, resultHash: computeCanonicalHash(resultWithoutHash) };
    }
    return runFidelityAwareSimulation(bars, config);
}
