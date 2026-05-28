import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import type {
  SyncLog,
  SyncAction,
  ConflictStrategy,
  PaginatedResponse,
} from '@shared/types';

/**
 * Row shape returned by the database.
 */
interface SyncLogRow {
  id: string;
  sync_job_id: string;
  record_id: string;
  action: SyncAction;
  source_data: Record<string, unknown> | null;
  target_data: Record<string, unknown> | null;
  conflict_detected: boolean;
  conflict_resolution: ConflictStrategy | null;
  error_message: string | null;
  created_at: string;
}

function rowToSyncLog(row: SyncLogRow): SyncLog {
  return {
    id: row.id,
    syncJobId: row.sync_job_id,
    recordId: row.record_id,
    action: row.action,
    sourceData: row.source_data,
    targetData: row.target_data,
    conflictDetected: row.conflict_detected,
    conflictResolution: row.conflict_resolution,
    errorMessage: row.error_message,
    createdAt: new Date(row.created_at),
  };
}

export interface CreateSyncLogInput {
  syncJobId: string;
  recordId: string;
  action: SyncAction;
  sourceData?: Record<string, unknown> | null;
  targetData?: Record<string, unknown> | null;
  conflictDetected?: boolean;
  conflictResolution?: ConflictStrategy | null;
  errorMessage?: string | null;
}

export interface SyncLogFilters {
  action?: SyncAction;
  conflictDetected?: boolean;
  limit?: number;
  offset?: number;
  sortOrder?: 'asc' | 'desc';
  startDate?: string;
  endDate?: string;
}

export const SyncLogModel = {
  /**
   * Create a single sync log entry.
   */
  async create(input: CreateSyncLogInput): Promise<SyncLog> {
    const id = uuidv4();
    const now = new Date().toISOString();

    const result = await query<SyncLogRow>(
      `INSERT INTO sync_logs
       (id, sync_job_id, record_id, action, source_data, target_data, conflict_detected, conflict_resolution, error_message, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        id,
        input.syncJobId,
        input.recordId,
        input.action,
        input.sourceData ? JSON.stringify(input.sourceData) : null,
        input.targetData ? JSON.stringify(input.targetData) : null,
        input.conflictDetected ?? false,
        input.conflictResolution ?? null,
        input.errorMessage ?? null,
        now,
      ],
    );

    return rowToSyncLog(result.rows[0]);
  },

  /**
   * Bulk create sync log entries in a single query.
   * Uses PostgreSQL multi-value INSERT for performance.
   */
  async bulkCreate(logs: CreateSyncLogInput[]): Promise<SyncLog[]> {
    if (logs.length === 0) {
      return [];
    }

    const now = new Date().toISOString();
    const valueStrings: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    for (const log of logs) {
      const id = uuidv4();
      const placeholders: string[] = [];

      // id
      placeholders.push(`$${paramIndex++}`);
      params.push(id);
      // sync_job_id
      placeholders.push(`$${paramIndex++}`);
      params.push(log.syncJobId);
      // record_id
      placeholders.push(`$${paramIndex++}`);
      params.push(log.recordId);
      // action
      placeholders.push(`$${paramIndex++}`);
      params.push(log.action);
      // source_data
      placeholders.push(`$${paramIndex++}`);
      params.push(log.sourceData ? JSON.stringify(log.sourceData) : null);
      // target_data
      placeholders.push(`$${paramIndex++}`);
      params.push(log.targetData ? JSON.stringify(log.targetData) : null);
      // conflict_detected
      placeholders.push(`$${paramIndex++}`);
      params.push(log.conflictDetected ?? false);
      // conflict_resolution
      placeholders.push(`$${paramIndex++}`);
      params.push(log.conflictResolution ?? null);
      // error_message
      placeholders.push(`$${paramIndex++}`);
      params.push(log.errorMessage ?? null);
      // created_at
      placeholders.push(`$${paramIndex++}`);
      params.push(now);

      valueStrings.push(`(${placeholders.join(', ')})`);
    }

    const sql = `INSERT INTO sync_logs
     (id, sync_job_id, record_id, action, source_data, target_data, conflict_detected, conflict_resolution, error_message, created_at)
     VALUES ${valueStrings.join(', ')}
     RETURNING *`;

    const result = await query<SyncLogRow>(sql, params);
    return result.rows.map(rowToSyncLog);
  },

  /**
   * Find all sync logs for a given sync job with optional filtering and pagination.
   */
  async findByJobId(
    jobId: string,
    filters?: SyncLogFilters,
  ): Promise<PaginatedResponse<SyncLog>> {
    const conditions: string[] = ['sync_job_id = $1'];
    const params: unknown[] = [jobId];
    let paramIndex = 2;

    if (filters?.action) {
      conditions.push(`action = $${paramIndex++}`);
      params.push(filters.action);
    }

    if (filters?.conflictDetected !== undefined) {
      conditions.push(`conflict_detected = $${paramIndex++}`);
      params.push(filters.conflictDetected);
    }

    if (filters?.startDate) {
      conditions.push(`created_at >= $${paramIndex++}`);
      params.push(filters.startDate);
    }

    if (filters?.endDate) {
      conditions.push(`created_at <= $${paramIndex++}`);
      params.push(filters.endDate);
    }

    const whereClause = conditions.join(' AND ');
    const limit = filters?.limit ?? 50;
    const offset = filters?.offset ?? 0;
    const sortOrder = filters?.sortOrder === 'asc' ? 'ASC' : 'DESC';

    // Count total
    const countResult = await query<{ count: number }>(
      `SELECT COUNT(*) as count FROM sync_logs WHERE ${whereClause}`,
      params,
    );
    const total = parseInt(countResult.rows[0].count as unknown as string, 10);

    // Fetch paginated
    const dataResult = await query<SyncLogRow>(
      `SELECT * FROM sync_logs
       WHERE ${whereClause}
       ORDER BY created_at ${sortOrder}
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, limit, offset],
    );

    return {
      data: dataResult.rows.map(rowToSyncLog),
      pagination: {
        total,
        limit,
        offset,
        hasNext: offset + limit < total,
      },
    };
  },

  /**
   * Find recent error logs for a store.
   * Useful for the dashboard error summary.
   */
  async findErrors(
    storeId: string,
    limit: number = 50,
  ): Promise<SyncLog[]> {
    const result = await query<SyncLogRow>(
      `SELECT sl.* FROM sync_logs sl
       JOIN sync_jobs sj ON sl.sync_job_id = sj.id
       WHERE sj.store_id = $1 AND sl.action = 'failed'
       ORDER BY sl.created_at DESC
       LIMIT $2`,
      [storeId, limit],
    );

    return result.rows.map(rowToSyncLog);
  },
};

export default SyncLogModel;
