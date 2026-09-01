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
export class EventQueue {
    heap = [];
    nextSequence = 0;
    enqueue(input) {
        if (!Number.isFinite(input.timestamp)) {
            throw new Error(`EventQueue.enqueue: timestamp must be a finite number, got ${input.timestamp}`);
        }
        const sequence = this.nextSequence++;
        const event = {
            eventId: `${input.eventType}:${input.timestamp}:${sequence}`,
            timestamp: input.timestamp,
            sequence,
            eventType: input.eventType,
            source: input.source,
            payload: input.payload,
        };
        this.heap.push(event);
        this.siftUp(this.heap.length - 1);
        return event;
    }
    peek() {
        return this.heap[0];
    }
    dequeue() {
        if (this.heap.length === 0)
            return undefined;
        const top = this.heap[0];
        const last = this.heap.pop();
        if (this.heap.length > 0) {
            this.heap[0] = last;
            this.siftDown(0);
        }
        return top;
    }
    isEmpty() {
        return this.heap.length === 0;
    }
    size() {
        return this.heap.length;
    }
    clear() {
        this.heap = [];
        this.nextSequence = 0;
    }
    static compare(a, b) {
        if (a.timestamp !== b.timestamp)
            return a.timestamp - b.timestamp;
        return a.sequence - b.sequence;
    }
    siftUp(index) {
        let i = index;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (EventQueue.compare(this.heap[i], this.heap[parent]) >= 0)
                break;
            [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
            i = parent;
        }
    }
    siftDown(index) {
        let i = index;
        const n = this.heap.length;
        for (;;) {
            const left = 2 * i + 1;
            const right = 2 * i + 2;
            let smallest = i;
            if (left < n && EventQueue.compare(this.heap[left], this.heap[smallest]) < 0)
                smallest = left;
            if (right < n && EventQueue.compare(this.heap[right], this.heap[smallest]) < 0)
                smallest = right;
            if (smallest === i)
                break;
            [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
            i = smallest;
        }
    }
}
