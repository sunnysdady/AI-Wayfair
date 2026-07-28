export const OPERATION_STATUSES: readonly string[];
export function assertOperationTransition(from: string, to: string): true;
export function validateOperationInput(input?: Record<string, unknown>): Record<string, unknown> & { operationId: string; status: string };
export function ensureOperationTables(db: D1Database): Promise<void>;
export function upsertOperation(db: D1Database, input: Record<string, unknown>, eventType?: string): Promise<Record<string, unknown>>;
export function listOperations(db: D1Database, filters?: {status?:string;objectId?:string;limit?:number}): Promise<Record<string, unknown>[]>;
