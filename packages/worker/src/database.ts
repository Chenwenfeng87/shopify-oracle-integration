import { Pool, QueryResult } from 'pg';
import { logger } from './logger';

let pool: Pool | null = null;

/**
 * Initializes the PostgreSQL connection pool.
 */
export function initDatabase(): Pool {
  if (pool) {
    return pool;
  }

  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!databaseUrl) {
    throw new Error(
      'Database connection string not configured. ' +
      'Set DATABASE_URL or POSTGRES_URL environment variable.'
    );
  }

  pool = new Pool({
    connectionString: databaseUrl,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('error', (err) => {
    logger.error('Unexpected database pool error', { error: err.message, stack: err.stack });
  });

  pool.on('connect', () => {
    logger.debug('New database connection acquired');
  });

  logger.info('Database pool initialized', {
    maxConnections: 20,
    idleTimeoutMs: 30000,
  });

  return pool;
}

/**
 * Returns the active database pool. Throws if not initialized.
 */
export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return pool;
}

/**
 * Execute a single query with optional parameters.
 */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const client = getPool();
  const start = Date.now();
  try {
    const result = await client.query<T>(sql, params);
    const duration = Date.now() - start;
    logger.debug('Query executed', {
      sql: sql.substring(0, 100),
      duration,
      rowCount: result.rowCount,
    });
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    logger.error('Query failed', {
      sql: sql.substring(0, 100),
      duration,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Fetch Oracle credentials for a store.
 */
export async function getOracleCredentials(
  storeId: string
): Promise<{ base_url: string; username: string; password: string; identity_domain: string | null } | null> {
  const result = await query<{
    base_url: string;
    username: string;
    password: string;
    identity_domain: string | null;
  }>(
    `SELECT base_url, username, password, identity_domain
     FROM oracle_credentials
     WHERE store_id = $1 AND is_valid = TRUE
     LIMIT 1`,
    [storeId]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Fetch field mappings for a store, entity type, and direction.
 */
export async function getFieldMappings(
  storeId: string,
  entityType: string,
  direction: string
): Promise<
  {
    shopify_field: string;
    oracle_field: string;
    transform_rule: Record<string, unknown> | null;
    is_required: boolean;
  }[]
> {
  const result = await query<{
    shopify_field: string;
    oracle_field: string;
    transform_rule: Record<string, unknown> | null;
    is_required: boolean;
  }>(
    `SELECT shopify_field, oracle_field, transform_rule, is_required
     FROM field_mappings
     WHERE store_id = $1 AND entity_type = $2 AND direction = $3
     ORDER BY is_required DESC, created_at ASC`,
    [storeId, entityType, direction]
  );
  return result.rows;
}

/**
 * Fetch sync config for a store and entity type.
 */
export async function getSyncConfig(
  storeId: string,
  entityType: string
): Promise<{
  batch_size: number;
  conflict_strategy: string;
  is_enabled: boolean;
} | null> {
  const result = await query<{
    batch_size: number;
    conflict_strategy: string;
    is_enabled: boolean;
  }>(
    `SELECT batch_size, conflict_strategy, is_enabled
     FROM sync_configs
     WHERE store_id = $1 AND entity_type = $2
     LIMIT 1`,
    [storeId, entityType]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Store a sync log entry.
 */
export async function insertSyncLog(params: {
  syncJobId: string;
  recordId: string;
  action: string;
  sourceData: Record<string, unknown> | null;
  targetData: Record<string, unknown> | null;
  conflictDetected: boolean;
  conflictResolution: string | null;
  errorMessage: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO sync_logs (sync_job_id, record_id, action, source_data, target_data, conflict_detected, conflict_resolution, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      params.syncJobId,
      params.recordId,
      params.action,
      params.sourceData ? JSON.stringify(params.sourceData) : null,
      params.targetData ? JSON.stringify(params.targetData) : null,
      params.conflictDetected,
      params.conflictResolution,
      params.errorMessage,
    ]
  );
}

/**
 * Update sync job progress.
 */
export async function updateSyncJobProgress(
  jobId: string,
  updates: {
    status?: string;
    processed_records?: number;
    failed_records?: number;
    error_summary?: Record<string, unknown> | null;
    completed_at?: Date | null;
  }
): Promise<void> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.status !== undefined) {
    setClauses.push(`status = $${paramIndex++}`);
    values.push(updates.status);
  }
  if (updates.processed_records !== undefined) {
    setClauses.push(`processed_records = $${paramIndex++}`);
    values.push(updates.processed_records);
  }
  if (updates.failed_records !== undefined) {
    setClauses.push(`failed_records = $${paramIndex++}`);
    values.push(updates.failed_records);
  }
  if (updates.error_summary !== undefined) {
    setClauses.push(`error_summary = $${paramIndex++}`);
    values.push(
      updates.error_summary ? JSON.stringify(updates.error_summary) : null
    );
  }
  if (updates.completed_at !== undefined) {
    setClauses.push(`completed_at = $${paramIndex++}`);
    values.push(updates.completed_at);
  }

  if (setClauses.length === 0) {
    return;
  }

  setClauses.push(`updated_at = NOW()`);

  values.push(jobId);
  await query(
    `UPDATE sync_jobs SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
    values
  );
}

/**
 * Gracefully close the database pool.
 */
export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Database pool closed');
  }
}
