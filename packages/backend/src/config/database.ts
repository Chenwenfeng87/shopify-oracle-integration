import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { config } from './app.config';
import { logger } from '../utils/logger';

const pool = new Pool({
  connectionString: config.database.url,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err: Error) => {
  logger.error('Unexpected database pool error', {
    error: err.message,
    stack: err.stack,
  });
});

pool.on('connect', () => {
  logger.debug('New database client acquired from pool');
});

pool.on('remove', () => {
  logger.debug('Database client removed from pool');
});

/**
 * Execute a query using the pool with automatic error handling.
 * Returns the query result on success.
 * Throws a wrapped error with context on failure.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  const start = Date.now();
  try {
    const result = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    logger.debug('Database query executed', {
      text: text.substring(0, 100),
      duration,
      rows: result.rowCount,
    });
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    const err = error as Error;
    logger.error('Database query failed', {
      text: text.substring(0, 100),
      duration,
      error: err.message,
    });
    throw new Error(`Database query failed: ${err.message}`);
  }
}

/**
 * Execute a query within a transaction.
 * The callback receives a client and can run multiple queries.
 * The transaction is committed on success and rolled back on error.
 */
export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackErr) => {
      logger.error('Transaction rollback failed', {
        error: (rollbackErr as Error).message,
      });
    });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get a dedicated client from the pool for long-running operations.
 * Caller must release the client when done.
 */
export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

/**
 * Test database connectivity by running a simple query.
 */
export async function testConnection(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch (error) {
    logger.error('Database connection test failed', {
      error: (error as Error).message,
    });
    return false;
  }
}

/**
 * Close all database connections gracefully.
 */
export async function closePool(): Promise<void> {
  logger.info('Closing database pool');
  await pool.end();
}

export { pool };
export default pool;
