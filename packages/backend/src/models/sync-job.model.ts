import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import type {
  EntityType,
  SyncDirection,
  SyncStatus,
  SyncTrigger,
  SyncJob,
  PaginatedResponse,
} from '@shared/types';

/**
 * Row shape returned by the database.
 */
interface SyncJobRow {
  id: string;
  store_id: string;
  entity_type: EntityType;
  direction: SyncDirection;
  status: SyncStatus;
  trigger: SyncTrigger;
  total_records: number;
  processed_records: number;
  failed_records: number;
  started_at: string | null;
  completed_at: string | null;
  error_summary: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

function rowToSyncJob(row: SyncJobRow): SyncJob {
  return {
    id: row.id,
    storeId: row.store_id,
    entityType: row.entity_type,
    direction: row.direction,
    status: row.status,
    trigger: row.trigger,
    totalRecords: row.total_records,
    processedRecords: row.processed_records,
    failedRecords: row.failed_records,
    startedAt: row.started_at ? new Date(row.started_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    errorSummary: row.error_summary,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export interface CreateSyncJobInput {
  storeId: string;
  entityType: EntityType;
  direction: SyncDirection;
  trigger: SyncTrigger;
  totalRecords?: number;
}

export interface SyncJobFilters {
  status?: SyncStatus;
  entityType?: EntityType;
  direction?: SyncDirection;
  trigger?: SyncTrigger;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  startDate?: string;
  endDate?: string;
}

export const SyncJobModel = {
  /**
   * Create a new sync job record.
   */
  async create(input: CreateSyncJobInput): Promise<SyncJob> {
    const id = uuidv4();
    const now = new Date().toISOString();

    const result = await query<SyncJobRow>(
      `INSERT INTO sync_jobs
       (id, store_id, entity_type, direction, status, trigger, total_records, processed_records, failed_records, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, 0, 0, $7, $7)
       RETURNING *`,
      [
        id,
        input.storeId,
        input.entityType,
        input.direction,
        input.trigger,
        input.totalRecords ?? 0,
        now,
      ],
    );

    return rowToSyncJob(result.rows[0]);
  },

  /**
   * Find a sync job by its ID.
   */
  async findById(id: string): Promise<SyncJob | null> {
    const result = await query<SyncJobRow>(
      'SELECT * FROM sync_jobs WHERE id = $1',
      [id],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return rowToSyncJob(result.rows[0]);
  },

  /**
   * Find all sync jobs for a store with optional filtering and pagination.
   */
  async findByStoreId(
    storeId: string,
    filters?: SyncJobFilters,
  ): Promise<PaginatedResponse<SyncJob>> {
    const conditions: string[] = ['store_id = $1'];
    const params: unknown[] = [storeId];
    let paramIndex = 2;

    if (filters?.status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(filters.status);
    }

    if (filters?.entityType) {
      conditions.push(`entity_type = $${paramIndex++}`);
      params.push(filters.entityType);
    }

    if (filters?.direction) {
      conditions.push(`direction = $${paramIndex++}`);
      params.push(filters.direction);
    }

    if (filters?.trigger) {
      conditions.push(`trigger = $${paramIndex++}`);
      params.push(filters.trigger);
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
    const limit = filters?.limit ?? 20;
    const offset = filters?.offset ?? 0;
    const sortBy = filters?.sortBy ?? 'created_at';
    const sortOrder = filters?.sortOrder ?? 'desc';

    // Validate sortBy to prevent SQL injection
    const allowedSortColumns = [
      'created_at',
      'updated_at',
      'started_at',
      'completed_at',
      'status',
      'entity_type',
      'total_records',
      'processed_records',
      'failed_records',
    ];
    const safeSortBy = allowedSortColumns.includes(sortBy)
      ? sortBy
      : 'created_at';
    const safeSortOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

    // Count total matching records
    const countResult = await query<{ count: number }>(
      `SELECT COUNT(*) as count FROM sync_jobs WHERE ${whereClause}`,
      params,
    );
    const total = parseInt(countResult.rows[0].count as unknown as string, 10);

    // Fetch paginated results
    const dataResult = await query<SyncJobRow>(
      `SELECT * FROM sync_jobs
       WHERE ${whereClause}
       ORDER BY ${safeSortBy} ${safeSortOrder}
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, limit, offset],
    );

    return {
      data: dataResult.rows.map(rowToSyncJob),
      pagination: {
        total,
        limit,
        offset,
        hasNext: offset + limit < total,
      },
    };
  },

  /**
   * Update the status of a sync job and optionally update other fields.
   */
  async updateStatus(
    id: string,
    status: SyncStatus,
    updates?: Partial<SyncJob>,
  ): Promise<void> {
    const now = new Date().toISOString();
    const setClauses: string[] = [`status = $1`, `updated_at = $2`];
    const params: unknown[] = [status, now];
    let paramIndex = 3;

    // Set started_at when job starts running
    if (status === 'running') {
      setClauses.push(`started_at = $${paramIndex++}`);
      params.push(now);
    }

    // Set completed_at when job finishes
    if (status === 'completed' || status === 'failed' || status === 'partial') {
      setClauses.push(`completed_at = $${paramIndex++}`);
      params.push(now);
    }

    if (updates) {
      if (updates.totalRecords !== undefined) {
        setClauses.push(`total_records = $${paramIndex++}`);
        params.push(updates.totalRecords);
      }
      if (updates.errorSummary !== undefined) {
        setClauses.push(`error_summary = $${paramIndex++}`);
        params.push(
          updates.errorSummary
            ? JSON.stringify(updates.errorSummary)
            : null,
        );
      }
    }

    params.push(id);
    await query(
      `UPDATE sync_jobs SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
      params,
    );
  },

  /**
   * Increment the progress counters for a running sync job.
   */
  async incrementProgress(
    id: string,
    processed: number,
    failed: number,
  ): Promise<void> {
    const now = new Date().toISOString();
    await query(
      `UPDATE sync_jobs
       SET processed_records = processed_records + $1,
           failed_records = failed_records + $2,
           updated_at = $3
       WHERE id = $4`,
      [processed, failed, now, id],
    );
  },

  /**
   * Cancel a pending or running sync job.
   */
  async cancel(id: string): Promise<void> {
    const now = new Date().toISOString();
    await query(
      `UPDATE sync_jobs
       SET status = 'failed',
           completed_at = $1,
           updated_at = $1,
           error_summary = '{"reason": "cancelled"}'
       WHERE id = $2
       AND (status = 'pending' OR status = 'queued' OR status = 'running')`,
      [now, id],
    );
  },
};

export default SyncJobModel;
