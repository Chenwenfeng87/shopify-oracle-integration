import { SyncQueueMessage, FieldMappingRow, RecordResult } from '../types';
import { query, getOracleCredentials, getPool } from '../database';
import { logger } from '../logger';
import {
  createShopifyClient,
  createOracleClient,
  transformData,
  processRecord,
  updateJobProgress,
} from './handler.utils';

/**
 * Handles customer synchronization between Shopify and Oracle.
 *
 * Direction: shopify_to_oracle (primary)
 * - Reads customer data from Shopify Admin API
 * - Transforms using field mappings
 * - Creates or updates customer records in Oracle Netsuite
 *
 * Direction: oracle_to_shopify
 * - Reads customer data from Oracle
 * - Transforms using field mappings
 * - Creates or updates customers in Shopify
 */
export class CustomerHandler {
  /**
   * Process a batch of customer sync records.
   */
  async process(message: SyncQueueMessage): Promise<void> {
    const { jobId, storeId, direction, records, mappings } = message;
    const log = logger.child({ jobId, storeId, entityType: 'customer', direction });

    log.info('Starting customer sync processing', {
      recordsCount: records.length,
    });

    // Fetch store details
    const storeResult = await query<{
      shopify_domain: string;
      access_token: string | null;
    }>(
      'SELECT shopify_domain, access_token FROM stores WHERE id = $1 AND is_active = TRUE',
      [storeId]
    );

    if (storeResult.rows.length === 0) {
      throw new Error(`Store ${storeId} not found or inactive`);
    }

    const { shopify_domain: shopifyDomain, access_token: accessToken } = storeResult.rows[0];

    if (!accessToken) {
      throw new Error(`Shopify access token not configured for store ${storeId}`);
    }

    // Fetch Oracle credentials
    const credentials = await getOracleCredentials(storeId);
    if (!credentials) {
      throw new Error(`Oracle credentials not configured for store ${storeId}`);
    }

    const typedMappings = mappings as FieldMappingRow[];
    const results: RecordResult[] = [];
    const errors: string[] = [];
    let processedCount = 0;
    let failedCount = 0;

    for (const record of records) {
      const recordId = record.id;

      const result = await processRecord(jobId, recordId, async () => {
        if (direction === 'shopify_to_oracle') {
          return await this.syncShopifyToOracle(
            record.data,
            typedMappings,
            shopifyDomain,
            accessToken,
            credentials
          );
        } else {
          return await this.syncOracleToShopify(
            record.data,
            typedMappings,
            shopifyDomain,
            accessToken,
            credentials
          );
        }
      });

      results.push(result);

      if (result.action === 'failed') {
        failedCount++;
        if (result.errorMessage) {
          errors.push(`Record ${recordId}: ${result.errorMessage}`);
        }
      } else {
        processedCount++;
      }
    }

    await updateJobProgress(jobId, processedCount, failedCount, errors);

    log.info('Customer sync processing complete', {
      processedRecords: processedCount,
      failedRecords: failedCount,
      totalRecords: records.length,
    });
  }

  /**
   * Sync a single customer from Shopify to Oracle.
   */
  private async syncShopifyToOracle(
    shopifyData: Record<string, unknown>,
    mappings: FieldMappingRow[],
    shopifyDomain: string,
    accessToken: string,
    credentials: { base_url: string; username: string; password: string; identity_domain: string | null }
  ): Promise<{
    action: string;
    sourceData: Record<string, unknown> | null;
    targetData: Record<string, unknown> | null;
  }> {
    const oracleClient = await createOracleClient(
      credentials.base_url,
      credentials.username,
      credentials.password,
      credentials.identity_domain
    );

    // Transform Shopify customer data to Oracle format
    const oracleData = transformData(
      shopifyData,
      mappings,
      'shopify_field',
      'oracle_field'
    );

    // Build PartyName from first_name + last_name if not directly mapped
    if (!oracleData.PartyName) {
      const firstName = (shopifyData.first_name as string) || '';
      const lastName = (shopifyData.last_name as string) || '';
      oracleData.PartyName = `${firstName} ${lastName}`.trim();
    }

    const email = oracleData.EmailAddress as string;
    if (!email) {
      throw new Error('Email is required for customer sync');
    }

    let action: string;
    let targetData: Record<string, unknown> | null;

    try {
      // Search for existing customer in Oracle by email
      const searchResponse = await oracleClient.get('/api/customers', {
        params: { q: `EmailAddress eq '${encodeURIComponent(email)}'`, limit: 1 },
      });

      const existingCustomers = (searchResponse.data?.items || []) as Record<string, unknown>[];

      if (existingCustomers.length > 0) {
        const existingCustomer = existingCustomers[0];
        const customerId = existingCustomer.id || existingCustomer.CustomerId;
        action = 'updated';

        const response = await oracleClient.patch(`/api/customers/${customerId}`, oracleData);
        targetData = response.data || oracleData;
      } else {
        action = 'created';
        const response = await oracleClient.post('/api/customers', oracleData);
        targetData = response.data || oracleData;
      }
    } catch (error) {
      logger.warn('Primary Oracle customer API failed, trying alternative', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback: try creating directly
      const response = await oracleClient.post('/api/customers', oracleData);
      targetData = response.data || oracleData;
      action = 'created';
    }

    return {
      action,
      sourceData: shopifyData,
      targetData,
    };
  }

  /**
   * Sync a single customer from Oracle to Shopify.
   */
  private async syncOracleToShopify(
    oracleData: Record<string, unknown>,
    mappings: FieldMappingRow[],
    shopifyDomain: string,
    accessToken: string,
    credentials: { base_url: string; username: string; password: string; identity_domain: string | null }
  ): Promise<{
    action: string;
    sourceData: Record<string, unknown> | null;
    targetData: Record<string, unknown> | null;
  }> {
    const shopifyClient = createShopifyClient(shopifyDomain, accessToken);

    // Transform Oracle data to Shopify format
    const shopifyData = transformData(
      oracleData,
      mappings,
      'oracle_field',
      'shopify_field'
    );

    // Parse PartyName into first_name / last_name if needed
    if (!shopifyData.first_name && !shopifyData.last_name && oracleData.PartyName) {
      const nameParts = (oracleData.PartyName as string).split(' ');
      shopifyData.first_name = nameParts[0] || '';
      shopifyData.last_name = nameParts.slice(1).join(' ') || '';
    }

    const email = shopifyData.email as string;
    if (!email) {
      throw new Error('Email is required for customer sync to Shopify');
    }

    let action: string;
    let targetData: Record<string, unknown> | null;

    // Search for existing customer in Shopify by email
    const searchResponse = await shopifyClient.get('/customers/search.json', {
      params: { query: `email:${email}`, limit: 1 },
    });

    const existingCustomers = searchResponse.data?.customers || [];

    if (existingCustomers.length > 0) {
      // Update existing customer
      const existingCustomer = existingCustomers[0];
      action = 'updated';

      const updatePayload: Record<string, unknown> = {};
      if (shopifyData.first_name) updatePayload.first_name = shopifyData.first_name;
      if (shopifyData.last_name) updatePayload.last_name = shopifyData.last_name;
      if (shopifyData.phone) updatePayload.phone = shopifyData.phone;
      if (shopifyData.note) updatePayload.note = shopifyData.note;
      if (shopifyData.tax_exempt !== undefined) updatePayload.tax_exempt = shopifyData.tax_exempt;

      const response = await shopifyClient.put(
        `/customers/${existingCustomer.id}.json`,
        { customer: updatePayload }
      );
      targetData = response.data?.customer || null;
    } else {
      // Create new customer
      action = 'created';

      const createPayload: Record<string, unknown> = {
        email,
        first_name: shopifyData.first_name || '',
        last_name: shopifyData.last_name || '',
      };
      if (shopifyData.phone) createPayload.phone = shopifyData.phone;
      if (shopifyData.note) createPayload.note = shopifyData.note;
      if (shopifyData.verified_email !== undefined) {
        createPayload.verified_email = shopifyData.verified_email;
      }

      const response = await shopifyClient.post('/customers.json', {
        customer: createPayload,
      });
      targetData = response.data?.customer || null;
    }

    return {
      action,
      sourceData: oracleData,
      targetData,
    };
  }
}
