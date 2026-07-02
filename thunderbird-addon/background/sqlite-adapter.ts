// Thin adapter that makes sql.js (SQLite compiled to wasm) look like the
// node:sqlite `DatabaseSync` API the original electron/db.ts was written
// against -- .prepare(sql).get(...)/.all(...)/.run(...). This is what lets
// db.ts's query bodies port over nearly verbatim; only the import and the
// async wrapper around getDb()/persist() are new.
import type { Database as SqlJsDatabase } from "sql.js";

export interface StatementAdapter {
  get(...params: any[]): any;
  all(...params: any[]): any[];
  run(...params: any[]): { changes: number };
}

export class DatabaseAdapter {
  constructor(private raw: SqlJsDatabase) {}

  prepare(sql: string): StatementAdapter {
    const raw = this.raw;
    return {
      get(...params: any[]) {
        const stmt = raw.prepare(sql);
        try {
          if (params.length) stmt.bind(params);
          const row = stmt.step() ? stmt.getAsObject() : undefined;
          return row;
        } finally {
          stmt.free();
        }
      },
      all(...params: any[]) {
        const stmt = raw.prepare(sql);
        const rows: any[] = [];
        try {
          if (params.length) stmt.bind(params);
          while (stmt.step()) rows.push(stmt.getAsObject());
        } finally {
          stmt.free();
        }
        return rows;
      },
      run(...params: any[]) {
        const stmt = raw.prepare(sql);
        try {
          if (params.length) stmt.bind(params);
          stmt.step();
        } finally {
          stmt.free();
        }
        return { changes: raw.getRowsModified() };
      }
    };
  }

  /** Runs (possibly multi-statement) DDL/plain SQL with no bound params. */
  exec(sql: string) {
    this.raw.run(sql);
  }

  /** Serializes the whole database to bytes, for persistence. */
  export(): Uint8Array {
    return this.raw.export();
  }
}
