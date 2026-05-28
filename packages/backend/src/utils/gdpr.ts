import { query } from '../config/database';
import { logger } from './logger';

/**
 * Handle a customer data request from Shopify (GDPR).
 * Shopify sends this when a customer requests all data the app holds about them.
 *
 * @param storeId - The store/customer ID from Shopify
 * @param customerId - The customer's email or customer ID
 * @returns A record containing all stored data about the customer
 */
export async function handleCustomerDataRequest(
  storeId: string,
  customerId: string,
): Promise<Record<string, unknown>> {
  logger.info('Handling GDPR customer data request', {
    storeId,
    customerId,
  });

  const customerData: Record<string, unknown> = {
    requestId: `${storeId}_${customerId}_${Date.now()}`,
    storeId,
    customerId,
    requestedAt: new Date().toISOString(),
  };

  try {
    // Look up store by domain or ID
    const storeResult = await query(
      'SELECT id, shopify_domain, created_at FROM stores WHERE id = $1 OR shopify_domain = $1',
      [storeId],
    );
    if (storeResult.rows.length > 0) {
      customerData.store = storeResult.rows[0];
    }

    // Look up sync jobs associated with this customer
    const syncJobsResult = await query(
      `SELECT id, entity_type, direction, status, created_at, completed_at
       FROM sync_jobs
       WHERE store_id = $1 AND entity_type = 'customer'
       ORDER BY created_at DESC
       LIMIT 50`,
      [storeId],
    );
    if (syncJobsResult.rows.length > 0) {
      customerData.syncJobs = syncJobsResult.rows;
    }

    // Look up sync logs related to this customer record
    const syncLogsResult = await query(
      `SELECT sl.id, sl.sync_job_id, sl.action, sl.created_at
       FROM sync_logs sl
       JOIN sync_jobs sj ON sl.sync_job_id = sj.id
       WHERE sj.store_id = $1 AND sl.record_id = $2
       ORDER BY sl.created_at DESC
       LIMIT 100`,
      [storeId, customerId],
    );
    if (syncLogsResult.rows.length > 0) {
      customerData.syncLogs = syncLogsResult.rows;
    }

    logger.info('Customer data request completed', {
      storeId,
      customerId,
      dataKeys: Object.keys(customerData),
    });

    return customerData;
  } catch (error) {
    logger.error('Failed to retrieve customer data for GDPR request', {
      storeId,
      customerId,
      error: (error as Error).message,
    });

    return {
      ...customerData,
      error: 'Failed to retrieve complete customer data',
      errorDetail: (error as Error).message,
    };
  }
}

/**
 * Handle a customer data redact request from Shopify (GDPR).
 * Shopify sends this when a customer requests deletion of their data.
 *
 * This function should:
 * 1. Anonymize or delete all records associated with the customer
 * 2. Remove the customer's personal data from sync logs
 * 3. Preserve aggregate/statistical data that doesn't identify the individual
 *
 * @param storeId - The store/customer ID from Shopify
 * @param customerId - The customer's email or customer ID
 */
export async function handleCustomerRedact(
  storeId: string,
  customerId: string,
): Promise<void> {
  logger.info('Handling GDPR customer data redaction', {
    storeId,
    customerId,
  });

  try {
    // Anonymize sync log entries that reference this customer record
    await query(
      `UPDATE sync_logs
       SET source_data = NULL,
           target_data = NULL,
           error_message = NULL
       WHERE sync_job_id IN (
         SELECT id FROM sync_jobs WHERE store_id = $1
       )
       AND record_id = $2`,
      [storeId, customerId],
    );

    logger.info('Customer data redaction completed', {
      storeId,
      customerId,
    });
  } catch (error) {
    logger.error('Failed to redact customer data for GDPR request', {
      storeId,
      customerId,
      error: (error as Error).message,
    });
    throw new Error(
      `Customer data redaction failed: ${(error as Error).message}`,
    );
  }
}

/**
 * Handle a shop data redact request from Shopify (GDPR).
 * Shopify sends this when a store owner uninstalls the app or requests
 * deletion of all their data.
 *
 * This function should:
 * 1. Anonymize or delete all store-related data
 * 2. Remove Oracle credentials for the store
 * 3. Anonymize sync jobs and logs
 * 4. Deactivate the store record
 *
 * @param storeId - The store domain to redact
 */
export async function handleShopRedact(storeId: string): Promise<void> {
  logger.info('Handling GDPR shop data redaction', {
    storeId,
  });

  try {
    // Anonymize sync logs for this store
    await query(
      `UPDATE sync_logs
       SET source_data = NULL,
           target_data = NULL,
           error_message = NULL
       WHERE sync_job_id IN (
         SELECT id FROM sync_jobs WHERE store_id = $1
       )`,
      [storeId],
    );

    // Anonymize sync jobs for this store
    await query(
      `UPDATE sync_jobs
       SET error_summary = NULL
       WHERE store_id = $1`,
      [storeId],
    );

    // Delete Oracle credentials for this store
    await query(
      'DELETE FROM oracle_credentials WHERE store_id = $1',
      [storeId],
    );

    // Delete field mappings for this store
    await query(
      'DELETE FROM field_mappings WHERE store_id = $1',
      [storeId],
    );

    // Delete billing subscriptions for this store
    await query(
      'DELETE FROM billing_subscriptions WHERE store_id = $1',
      [storeId],
    );

    // Deactivate the store
    await query(
      "UPDATE stores SET is_active = false, uninstalled_at = NOW(), shopify_token = NULL WHERE id = $1 OR shopify_domain = $1",
      [storeId],
    );

    logger.info('Shop data redaction completed', {
      storeId,
    });
  } catch (error) {
    logger.error('Failed to redact shop data for GDPR request', {
      storeId,
      error: (error as Error).message,
    });
    throw new Error(
      `Shop data redaction failed: ${(error as Error).message}`,
    );
  }
}
