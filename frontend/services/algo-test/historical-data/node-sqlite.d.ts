// P3.2A - a minimal, scoped ambient declaration for Node's built-in
// "node:sqlite" module (stable since Node 22.5, used here on Node 24).
// The repo's pinned @types/node ("^20") predates this module, so no
// upstream types exist yet - rather than bump @types/node globally (a
// much larger blast radius than this foundation sprint's "smallest
// additive change" scope), this declares only the exact surface
// market-db-provider.ts actually uses.
declare module "node:sqlite" {
  export interface DatabaseSyncOptions {
    readOnly?: boolean;
  }

  export interface StatementSync {
    all(...params: unknown[]): unknown[];
  }

  export class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions);
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
