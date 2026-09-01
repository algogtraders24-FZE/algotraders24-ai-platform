import type { SimulationEvent, SimulationEventType } from "../../domain/simulation/event.js";
export interface EnqueueInput<TPayload = unknown> {
    readonly timestamp: number;
    readonly eventType: SimulationEventType;
    readonly source: string;
    readonly payload: TPayload;
}
/**
 * Deterministic (timestamp ASC, sequence ASC) priority queue (Q0.5.2).
 * `sequence` is assigned here, at enqueue time, as a monotonically
 * increasing counter — never the caller's responsibility, never derived
 * from the wall clock, a random source, or object-iteration order. Because
 * `sequence` is strictly increasing in enqueue order, two events with the
 * identical `timestamp` are naturally FIFO-ordered by when they were
 * enqueued, satisfying "stable FIFO behavior for identical timestamps"
 * without any extra bookkeeping.
 *
 * Implemented as a binary min-heap keyed on (timestamp, sequence) — O(log n)
 * enqueue/dequeue. Correctness first (Q0.4.22/Q0.5.45): no attempt at a
 * more exotic structure.
 */
export declare class EventQueue {
    private heap;
    private nextSequence;
    enqueue<TPayload>(input: EnqueueInput<TPayload>): SimulationEvent<TPayload>;
    peek(): SimulationEvent | undefined;
    dequeue(): SimulationEvent | undefined;
    isEmpty(): boolean;
    size(): number;
    clear(): void;
    private static compare;
    private siftUp;
    private siftDown;
}
