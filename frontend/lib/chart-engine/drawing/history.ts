// lib/chart-engine/drawing/history.ts
// Undo / redo for the drawn objects of one chart. Pure: every state is the whole object array (they are small, max 200 per chart),
// so restoring is exact and cannot drift. The chart commits through record(); a load from the server uses reset().
import type { DrawingObject } from "./types";

export const MAX_HISTORY = 50;

export class DrawingHistory {
  private undoStack: DrawingObject[][] = [];
  private redoStack: DrawingObject[][] = [];

  /** Call BEFORE the objects change, with the array as it is now. Clears the redo stack. */
  record(current: DrawingObject[]): void {
    this.undoStack.push(current);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Returns the array to restore, or null if there is nothing to undo. `current` is kept for redo. */
  undo(current: DrawingObject[]): DrawingObject[] | null {
    const prev = this.undoStack.pop();
    if (!prev) return null;
    this.redoStack.push(current);
    return prev;
  }

  redo(current: DrawingObject[]): DrawingObject[] | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(current);
    return next;
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }
  reset(): void { this.undoStack = []; this.redoStack = []; }
}
