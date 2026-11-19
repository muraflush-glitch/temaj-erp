// Në shfletues nuk ka lidhje rrjeti me databazën: "Pool" jepet nga adaptori mbi PGlite (src/backend.ts).
export class Pool {}
export type PoolClient = unknown;
export type QueryResultRow = Record<string, unknown>;
