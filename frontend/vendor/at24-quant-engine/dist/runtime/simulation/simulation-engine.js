import { validateMarketSeries } from "../../domain/market-series.js";
import { generateSignal } from "../signal-generator.js";
import { evaluateRisk } from "../risk/pipeline.js";
import { computeTradingDayKey } from "../risk/daily-loss.js";
import { computeCanonicalHash } from "../determinism.js";
import { computeSemanticStrategyHash } from "../identity.js";
import { computeCoreMetrics } from "../../domain/metrics.js";
import { EventQueue } from "./event-queue.js";
import { createOrder, transitionOrder, isOrderExpired } from "./order-engine.js";
import { validateOrderModification } from "../../domain/simulation/order-modification.js";
import { applyOrderModification } from "./order-modification.js";
import { executableRules } from "../../domain/pending-order-management-policy.js";
import { evaluatePendingOrderManagementPolicy } from "./pending-order-management.js";
import { resolveMarketFill, resolveLimitFill, resolveStopFill, resolveStopLimitFill, resolveProtectiveExit } from "./bar-fill-model.js";
import { openPosition, increasePosition, reducePosition, closePosition, computeUnrealizedPnl } from "./position-engine.js";
import { createAccount, applyFill, markToMarket } from "./account-engine.js";
import { TradeLedger, buildTrade } from "./trade-ledger.js";
import { buildDecision } from "./decision-builder.js";
import { resolveStopLossPrice, resolveTakeProfitPrice, resolvePositionSize } from "./rule-resolvers.js";
import { mapRiskAction } from "./risk-action-mapping.js";
import { resolvePriceReference } from "../strategy-ir/price-reference-resolver.js";
const RUNTIME_VERSION = "0.1.0";
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
    };
}
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
/**
 * Runs a full, deterministic, single-instrument/single-strategy
 * simulation over `bars` (Q0.5.29). Only ON_BAR_CLOSE calculation timing
 * is implemented (Q0's existing generateSignal() semantics) — no new
 * recalculation semantics are invented here, per Q0.5.29's explicit
 * instruction.
 */
export function runSimulation(bars, config) {
    const seriesCheck = validateMarketSeries({ instrument: config.instrument, timeframe: config.timeframe, bars });
    if (!seriesCheck.valid) {
        throw new Error(`runSimulation: invalid market series: ${seriesCheck.errors.join("; ")}`);
    }
    const symbol = config.instrument.symbol;
    const strategyHash = computeSemanticStrategyHash(config.strategySpec);
    const queue = new EventQueue();
    const eventCounts = {};
    const executionStats = { ordersCreated: 0, ordersFilled: 0, ordersRejected: 0, ordersCancelled: 0, ordersExpired: 0 };
    const ledger = new TradeLedger();
    function record(eventType, timestamp, payload) {
        const evt = queue.enqueue({ timestamp, eventType, source: "SimulationEngine", payload });
        eventCounts[evt.eventType] = (eventCounts[evt.eventType] ?? 0) + 1;
        return evt;
    }
    // Only the FIRST bar is seeded upfront. Seeding every bar in one bulk
    // pass up front would assign later bars' event-queue `sequence` numbers
    // before any of the current bar's derived events (STRATEGY_CALCULATED,
    // ORDER_*, POSITION_*) are created — meaning the mere PRESENCE of future
    // bars would shift the sequence numbers (and therefore the deterministic
    // orderId/tradeId strings) assigned to historical events, even though no
    // decision or price actually changes. Each subsequent bar is enqueued
    // only once the current bar's entire processing pipeline (and all of its
    // derived events) has already been assigned its sequence numbers — see
    // the end of the MARKET_BAR handling below. This is what makes Q0.5.39's
    // lookahead-safety guarantee hold at the ID level, not just the value
    // level.
    if (bars.length > 0) {
        queue.enqueue({ timestamp: bars[0].timestamp, eventType: "MARKET_BAR", source: "SimulationEngine", payload: { bar: bars[0], barIndex: 0 } });
    }
    function applyRealizedTrade(state, position, exitPrice, exitQuantity, grossPnl, fee, timestamp, exitReason) {
        const account = applyFill(state.account, grossPnl, fee, timestamp);
        const trade = buildTrade({
            tradeId: `${position.id}:${timestamp}:${state.ledger.length}`,
            strategyVersion: config.strategySpec.version,
            position,
            exitPrice,
            exitTimestamp: timestamp,
            quantity: exitQuantity,
            grossPnl,
            fees: fee,
            fillModel: "BarFillModel",
            spreadModel: config.spreadModel.name,
            slippageModel: config.slippageModel.name,
            feeModel: config.feeModel.name,
            ...(exitReason !== undefined ? { exitReason } : {}),
        });
        ledger.record(trade);
        return { ...state, account, ledger: ledger.all(), realizedPnlToday: state.realizedPnlToday + grossPnl - fee };
    }
    let state = createInitialState(config.initialBalance, bars.length > 0 ? bars[0].timestamp : 0);
    let event = queue.dequeue();
    while (event !== undefined) {
        if (event.eventType !== "MARKET_BAR") {
            // Derived audit-trail events (ORDER_*/POSITION_*/STRATEGY_CALCULATED)
            // are already fully applied at creation time — dequeuing them here
            // only advances statistics, never re-triggers state changes
            // (Q0.5.29: no re-entrant recalculation semantics are invented).
            event = queue.dequeue();
            continue;
        }
        eventCounts.MARKET_BAR = (eventCounts.MARKET_BAR ?? 0) + 1;
        const { bar, barIndex } = event.payload;
        state = { ...state, clock: bar.timestamp };
        // --- Step 0.4 (Q0.13): evaluate any compiled PendingOrderManagementPolicy against every
        // currently-pending order for THIS symbol, using ONLY this bar's own data (no lookahead) —
        // runs BEFORE Step 0.5's declarative schedule so a policy-driven cancel/modify this bar is
        // itself subject to (never silently overridden by) anything explicitly scheduled for the
        // same bar. See docs/Q0.13_SIMULATION_BRIDGE.md.
        if (config.pendingOrderManagementPolicy) {
            const executable = executableRules(config.pendingOrderManagementPolicy);
            if (executable.length > 0) {
                const atrForPolicy = config.atrByIndex?.[barIndex];
                for (const [orderId, order] of state.pendingOrders) {
                    if (order.instrument.symbol !== symbol)
                        continue;
                    if (order.creationTimestamp >= bar.timestamp)
                        continue; // same-bar safety guard, exactly Step 1's own rule below
                    const intent = evaluatePendingOrderManagementPolicy({ rules: executable }, order, bar, "pending-order management policy", atrForPolicy);
                    if (!intent)
                        continue;
                    const validation = validateOrderModification(order, intent, bar.close);
                    if (!validation.valid) {
                        record("ORDER_MODIFICATION_REJECTED", bar.timestamp, { orderId, errors: validation.errors });
                        continue;
                    }
                    // Q0.13's own evaluator only ever produces CANCEL/MODIFY_STOP/MODIFY_LIMIT/MODIFY_EXPIRATION
                    // intents (never REPLACE — see pending-order-management-policy.ts's operation vocabulary),
                    // so `applyOrderModification` can only ever return "CANCELLED" or "MODIFIED" here; the
                    // "REPLACED" arm is handled defensively (never expected to execute) for type-safety only.
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
        // --- Step 0.5 (Q0.12): apply any scheduled order modifications for THIS bar, before fill resolution ---
        for (const mod of config.orderModifications ?? []) {
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
        // --- Step 1: resolve pending orders against this bar ---
        for (const [orderId, order] of state.pendingOrders) {
            if (order.instrument.symbol !== symbol)
                continue;
            if (order.creationTimestamp >= bar.timestamp)
                continue; // same-bar safety guard (Q0.5.30)
            // Q0.12.21 — expiration is checked BEFORE fill resolution; an expired order never fills, even if this bar's OHLC would otherwise trigger it.
            const creationBarIndex = state.orderCreationBarIndex.get(orderId) ?? barIndex;
            if (isOrderExpired(order, {
                asOf: bar.timestamp,
                currentBarIndex: barIndex,
                creationBarIndex,
                ...(config.dayBoundaryOffsetMinutes !== undefined ? { dayBoundaryOffsetMinutes: config.dayBoundaryOffsetMinutes } : {}),
            })) {
                const expired = transitionOrder(order, "EXPIRED", { terminalReason: "expiration policy reached" });
                state = { ...state, pendingOrders: mapWithout(state.pendingOrders, orderId) };
                record("ORDER_EXPIRED", bar.timestamp, { orderId });
                executionStats.ordersExpired += 1;
                void expired;
                continue;
            }
            let outcome;
            if (order.orderType === "MARKET")
                outcome = resolveMarketFill(order, bar, config.spreadModel, config.slippageModel);
            else if (order.orderType === "LIMIT")
                outcome = resolveLimitFill(order, bar);
            else if (order.orderType === "STOP")
                outcome = resolveStopFill(order, bar);
            else
                outcome = order.status === "TRIGGERED" ? resolveLimitFill(order, bar) : resolveStopLimitFill(order, bar);
            if (outcome.filled) {
                const fillPrice = outcome.fillPrice;
                const fee = config.feeModel.computeFee({ quantity: order.quantity, notional: fillPrice * order.quantity });
                const filledOrder = transitionOrder(order, "FILLED", { filledQuantity: order.quantity, averageFillPrice: fillPrice });
                state = { ...state, pendingOrders: mapWithout(state.pendingOrders, orderId) };
                record("ORDER_FILLED", bar.timestamp, { orderId, fillPrice });
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
                        entryTimestamp: bar.timestamp,
                        ...(order.attachedStopLoss !== undefined ? { stopLoss: order.attachedStopLoss } : {}),
                        ...(order.attachedTakeProfit !== undefined ? { takeProfit: order.attachedTakeProfit } : {}),
                        fee,
                    });
                    state = {
                        ...state,
                        openPositions: mapWith(state.openPositions, symbol, position),
                        entryBarIndexByPosition: mapWith(state.entryBarIndexByPosition, position.id, barIndex),
                    };
                    record("POSITION_OPENED", bar.timestamp, { positionId: position.id });
                }
                else if (existing.side === order.side) {
                    const updated = increasePosition(existing, order.quantity, fillPrice, bar.timestamp, fee);
                    state = { ...state, openPositions: mapWith(state.openPositions, symbol, updated) };
                    record("POSITION_MODIFIED", bar.timestamp, { positionId: updated.id });
                }
                else {
                    const reduceQty = Math.min(order.quantity, existing.quantity);
                    const { position: reduced, grossPnl } = reducePosition(existing, reduceQty, fillPrice, bar.timestamp, fee);
                    state = applyRealizedTrade(state, existing, fillPrice, reduceQty, grossPnl, fee, bar.timestamp, "opposite-side order fill reduced/closed the position");
                    record(reduced.status === "CLOSED" ? "POSITION_CLOSED" : "POSITION_REDUCED", bar.timestamp, { positionId: reduced.id });
                    const leftover = order.quantity - reduceQty;
                    if (leftover > 0 && reduced.status === "CLOSED") {
                        const reversal = openPosition({
                            id: `${filledOrder.orderId}:reversal`,
                            originatingOrderIntentId: filledOrder.orderId,
                            instrument: order.instrument,
                            side: order.side,
                            quantity: leftover,
                            entryPrice: fillPrice,
                            entryTimestamp: bar.timestamp,
                            ...(order.attachedStopLoss !== undefined ? { stopLoss: order.attachedStopLoss } : {}),
                            ...(order.attachedTakeProfit !== undefined ? { takeProfit: order.attachedTakeProfit } : {}),
                            fee: 0,
                        });
                        state = {
                            ...state,
                            openPositions: mapWith(state.openPositions, symbol, reversal),
                            entryBarIndexByPosition: mapWith(state.entryBarIndexByPosition, reversal.id, barIndex),
                        };
                        record("POSITION_OPENED", bar.timestamp, { positionId: reversal.id });
                    }
                    else {
                        state = {
                            ...state,
                            openPositions: reduced.status === "CLOSED" ? mapWithout(state.openPositions, symbol) : mapWith(state.openPositions, symbol, reduced),
                        };
                    }
                }
            }
            else if (outcome.triggeredOnly) {
                const triggered = transitionOrder(order, "TRIGGERED");
                state = { ...state, pendingOrders: mapWith(state.pendingOrders, orderId, triggered) };
                record("ORDER_TRIGGERED", bar.timestamp, { orderId });
            }
        }
        // --- Step 1b: check the open position's own protective SL/TP against this bar (Q0.5.8/Q0.5.32) ---
        const positionForProtectiveCheck = state.openPositions.get(symbol);
        if (positionForProtectiveCheck) {
            const exit = resolveProtectiveExit(positionForProtectiveCheck.side, positionForProtectiveCheck.stopLoss, positionForProtectiveCheck.takeProfit, bar);
            if (exit.exited) {
                const fee = config.feeModel.computeFee({ quantity: positionForProtectiveCheck.quantity, notional: exit.exitPrice * positionForProtectiveCheck.quantity });
                const { position: closed, grossPnl } = closePosition(positionForProtectiveCheck, exit.exitPrice, bar.timestamp, fee);
                state = applyRealizedTrade(state, positionForProtectiveCheck, exit.exitPrice, positionForProtectiveCheck.quantity, grossPnl, fee, bar.timestamp, exit.reason);
                state = { ...state, openPositions: mapWithout(state.openPositions, symbol) };
                record("POSITION_CLOSED", bar.timestamp, { positionId: closed.id, reason: exit.reason, ambiguous: exit.ambiguous ?? false });
            }
        }
        // --- Step 2: mark to market ---
        const posNow = state.openPositions.get(symbol);
        const unrealized = posNow ? computeUnrealizedPnl(posNow, bar.close) : 0;
        if (unrealized !== state.account.unrealizedPnl) {
            state = { ...state, account: markToMarket(state.account, unrealized, bar.timestamp) };
        }
        // --- Step 3: day-boundary tracking ---
        const dayKey = computeTradingDayKey(bar.timestamp, config.dayBoundaryOffsetMinutes ?? 0);
        if (dayKey !== state.tradingDayKey) {
            state = { ...state, tradingDayKey: dayKey, realizedPnlToday: 0, equityAtDayStart: state.account.equity };
        }
        // --- Step 4: strategy calculation (ON_BAR_CLOSE only) ---
        const indicatorValues = buildIndicatorMap(config.indicatorSeries, barIndex);
        const previousIndicatorValues = barIndex > 0 ? buildIndicatorMap(config.indicatorSeries, barIndex - 1) : undefined;
        const marketState = {
            instrument: config.instrument,
            timeframe: config.timeframe,
            asOf: bar.timestamp,
            bars: bars.slice(0, barIndex + 1),
            indicatorValues,
            ...(previousIndicatorValues !== undefined ? { previousIndicatorValues } : {}),
        };
        const signal = generateSignal(config.strategySpec, marketState);
        const currentPosition = state.openPositions.get(symbol);
        const hasPendingOrderForSymbol = [...state.pendingOrders.values()].some((o) => o.instrument.symbol === symbol);
        const decision = buildDecision(signal, currentPosition !== undefined, hasPendingOrderForSymbol);
        record("STRATEGY_CALCULATED", bar.timestamp, { strategyHash, signal, decision });
        // --- Step 5: risk evaluation ---
        const atrValue = config.atrByIndex?.[barIndex];
        let riskInput;
        if (currentPosition) {
            riskInput = {
                asOf: bar.timestamp,
                riskSpecification: config.strategySpec.risk,
                instrument: config.instrument,
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
        else if (decision.action === "ENTER") {
            const direction = signal.direction;
            // Q0.11 — the matched EntryRule's own executionType/limitPrice/stopPrice
            // (absent means MARKET, Q0's original assumption, unchanged). A
            // PriceReference is resolved to a concrete number HERE, using the
            // exact same MarketState Step 4 already built for signal generation
            // — never a second, divergent notion of "current market state."
            const matchedRule = config.strategySpec.entryRules.find((r) => r.id === signal.triggeredByRuleId);
            const orderType = matchedRule?.executionType;
            const limitPrice = matchedRule?.limitPrice !== undefined ? resolvePriceReference(matchedRule.limitPrice, marketState) : undefined;
            const stopPrice = matchedRule?.stopPrice !== undefined ? resolvePriceReference(matchedRule.stopPrice, marketState) : undefined;
            // Q0.11 fix — a LIMIT/STOP/STOP_LIMIT order's own price is DETERMINISTICALLY
            // KNOWN at signal time (unlike a MARKET order's eventual fill price, which
            // isn't known until the next bar) — computing SL/TP relative to `bar.close`
            // when a strictly more accurate, already-known reference price exists would
            // be even more misleading here than for MARKET orders, since a LIMIT/STOP
            // order's entire purpose is to enter at a DIFFERENT price than the current
            // one. `limitPrice` (the order's final intended entry) takes precedence over
            // `stopPrice` (just the trigger) for STOP_LIMIT; `bar.close` remains the
            // reference for MARKET orders, unchanged. See docs/Q0.11_ORDER_SEMANTICS.md.
            const riskReferencePrice = limitPrice ?? stopPrice ?? bar.close;
            const stopLossPrice = resolveStopLossPrice(config.strategySpec.risk.stopLoss, direction, riskReferencePrice, atrValue);
            const takeProfitPrice = resolveTakeProfitPrice(config.strategySpec.risk.takeProfit, direction, riskReferencePrice, stopLossPrice);
            const quantity = resolvePositionSize(config.strategySpec.risk.sizing, {
                entryPrice: riskReferencePrice,
                ...(stopLossPrice !== undefined ? { stopLossPrice } : {}),
                equity: state.account.equity,
            });
            riskInput = {
                asOf: bar.timestamp,
                riskSpecification: config.strategySpec.risk,
                instrument: config.instrument,
                direction,
                proposedEntry: {
                    quantity,
                    // Consistent with stopLossPrice/takeProfitPrice above: geometry
                    // validation (entryPrice vs stopLoss/takeProfit direction) must
                    // compare against the SAME reference price they were computed
                    // from, never a different one.
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
        if (riskInput) {
            const riskResult = evaluateRisk(riskInput);
            const mapping = mapRiskAction(riskResult.action);
            if (mapping.kind === "CREATE_ENTRY_ORDER") {
                const entry = riskInput.proposedEntry;
                const createdEvt = record("ORDER_CREATED", bar.timestamp, {});
                const order = createOrder({
                    strategyVersion: config.strategySpec.version,
                    instrument: config.instrument,
                    side: riskInput.direction,
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
                const fee = config.feeModel.computeFee({ quantity: reduceQty, notional: bar.close * reduceQty });
                const { position: reduced, grossPnl } = reducePosition(currentPosition, reduceQty, bar.close, bar.timestamp, fee);
                state = applyRealizedTrade(state, currentPosition, bar.close, reduceQty, grossPnl, fee, bar.timestamp, "risk engine partial close");
                state = { ...state, partialCloseTriggered: setWith(state.partialCloseTriggered, currentPosition.id) };
                state = {
                    ...state,
                    openPositions: reduced.status === "CLOSED" ? mapWithout(state.openPositions, symbol) : mapWith(state.openPositions, symbol, reduced),
                };
                record(reduced.status === "CLOSED" ? "POSITION_CLOSED" : "POSITION_REDUCED", bar.timestamp, { positionId: reduced.id });
            }
            else if (mapping.kind === "FORCE_EXIT" && currentPosition) {
                const fee = config.feeModel.computeFee({ quantity: currentPosition.quantity, notional: bar.close * currentPosition.quantity });
                const { position: closed, grossPnl } = closePosition(currentPosition, bar.close, bar.timestamp, fee);
                state = applyRealizedTrade(state, currentPosition, bar.close, currentPosition.quantity, grossPnl, fee, bar.timestamp, "risk engine forced exit");
                state = { ...state, openPositions: mapWithout(state.openPositions, symbol) };
                record("POSITION_CLOSED", bar.timestamp, { positionId: closed.id });
            }
            // NO_OP / REJECT_ENTRY: nothing to do.
        }
        // Enqueue the NEXT bar only now, after every derived event this bar
        // produced has already consumed its sequence number — see the
        // seeding comment above for why ordering this matters.
        if (barIndex + 1 < bars.length) {
            const nextBar = bars[barIndex + 1];
            queue.enqueue({ timestamp: nextBar.timestamp, eventType: "MARKET_BAR", source: "SimulationEngine", payload: { bar: nextBar, barIndex: barIndex + 1 } });
        }
        event = queue.dequeue();
    }
    // --- Finalize: any still-ACCEPTED/TRIGGERED order at end-of-run expires (never left dangling). ---
    for (const [orderId, order] of state.pendingOrders) {
        const expired = transitionOrder(order, "EXPIRED", { terminalReason: "simulation ended with no further bars" });
        state = { ...state, pendingOrders: mapWithout(state.pendingOrders, orderId) };
        executionStats.ordersExpired += 1;
        void expired;
    }
    const eventStatistics = {
        totalEvents: Object.values(eventCounts).reduce((a, b) => a + b, 0),
        eventsByType: { ...eventCounts },
    };
    const executionStatistics = { ...executionStats };
    const provenance = {
        strategyHash,
        strategyVersion: config.strategySpec.version,
        datasetId: config.datasetId,
        datasetVersion: config.datasetVersion,
        dataFidelity: config.dataFidelity,
        executionModel: "SimulationEngine-v1",
        fillModel: "BarFillModel",
        spreadModel: config.spreadModel.name,
        slippageModel: config.slippageModel.name,
        feeModel: config.feeModel.name,
        latencyModel: config.latencyModel.name,
        initialBalance: config.initialBalance,
        positionAccountingMode: "NETTING",
        runtimeVersion: RUNTIME_VERSION,
    };
    const trades = ledger.all();
    const coreMetrics = computeCoreMetrics(trades.map((t) => ({ pnl: t.netPnl })), config.initialBalance);
    const rValues = trades.map((t) => t.rMultiple).filter((r) => r !== null);
    const averageR = rValues.length > 0 ? rValues.reduce((a, b) => a + b, 0) / rValues.length : null;
    const totalFees = trades.reduce((sum, t) => sum + t.fees, 0);
    const metrics = {
        ...coreMetrics,
        averageR,
        totalFees,
    };
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
