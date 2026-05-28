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
 * Handles order synchronization between Shopify and Oracle.
 *
 * Direction: shopify_to_oracle (primary)
 * - Reads order data from Shopify Admin API
 * - Transforms using field mappings
 * - Creates or updates order records in Oracle Order Management
 *
 * Direction: oracle_to_shopify
 * - Reads order data from Oracle
 * - Creates or updates orders in Shopify
 */
export class OrderHandler {
  /**
   * Process a batch of order sync records.
   */
  async process(message: SyncQueueMessage): Promise<void> {
    const { jobId, storeId, direction, records, mappings } = message;
    const log = logger.child({ jobId, storeId, entityType: 'order', direction });

    log.info('Starting order sync processing', {
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

    log.info('Order sync processing complete', {
      processedRecords: processedCount,
      failedRecords: failedCount,
      totalRecords: records.length,
    });
  }

  /**
   * Sync a single order from Shopify to Oracle Order Management.
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

    // Transform Shopify order data to Oracle format
    const oracleData = transformData(
      shopifyData,
      mappings,
      'shopify_field',
      'oracle_field'
    );

    const orderNumber = oracleData.OrderNumber as string;
    if (!orderNumber) {
      throw new Error('OrderNumber is required for order sync');
    }

    // Extract line items from Shopify order and transform them
    const lineItems = shopifyData.line_items as Array<Record<string, unknown>> | undefined;
    if (lineItems && lineItems.length > 0) {
      oracleData.OrderLines = lineItems.map((item, index) => ({
        LineNumber: index + 1,
        ItemNumber: item.sku || '',
        ItemDescription: item.name || '',
        Quantity: item.quantity || 1,
        UnitPrice: item.price || 0,
        TotalAmount: (item.quantity as number) * parseFloat(String(item.price || 0)),
      }));
    }

    let action: string;
    let targetData: Record<string, unknown> | null;

    try {
      // Check if order already exists in Oracle
      const searchResponse = await oracleClient.get('/api/orders', {
        params: { q: `OrderNumber eq '${encodeURIComponent(orderNumber)}'`, limit: 1 },
      });

      const existingOrders = (searchResponse.data?.items || []) as Record<string, unknown>[];

      if (existingOrders.length > 0) {
        const existingOrder = existingOrders[0];
        const orderId = existingOrder.id || existingOrder.OrderId;
        action = 'updated';

        const response = await oracleClient.patch(`/api/orders/${orderId}`, oracleData);
        targetData = response.data || oracleData;
      } else {
        action = 'created';
        const response = await oracleClient.post('/api/orders', oracleData);
        targetData = response.data || oracleData;
      }
    } catch (error) {
      logger.warn('Primary Oracle order API failed, trying alternative', {
        error: error instanceof Error ? error.message : String(error),
      });

      const response = await oracleClient.post('/api/orders', oracleData);
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
   * Sync a single order from Oracle to Shopify.
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

    const orderNumber = shopifyData.order_number as number;
    if (!orderNumber) {
      throw new Error('Order number is required for order sync to Shopify');
    }

    let action: string;
    let targetData: Record<string, unknown> | null;

    // Search for existing order in Shopify by order number
    const searchResponse = await shopifyClient.get('/orders.json', {
      params: { name: orderNumber, limit: 1, status: 'any' },
    });

    const existingOrders = searchResponse.data?.orders || [];

    if (existingOrders.length > 0) {
      // Orders in Shopify are generally immutable for financial fields
      // Only update notes and metadata
      const existingOrder = existingOrders[0];
      action = 'updated';

      const updatePayload: Record<string, unknown> = {};
      if (shopifyData.note) updatePayload.note = shopifyData.note;
      if (shopifyData.tags) updatePayload.tags = shopifyData.tags;

      // Add metafields for Oracle reference
      if (oracleData.OrderId) {
        updatePayload.metafields = [
          {
            key: 'oracle_order_id',
            value: String(oracleData.OrderId),
            type: 'single_line_text_field',
            namespace: 'oracle_integration',
          },
        ];
      }

      const response = await shopifyClient.put(
        `/orders/${existingOrder.id}.json`,
        { order: updatePayload }
      );
      targetData = response.data?.order || null;
    } else {
      // Create order in Shopify (typically this would be rare for orders)
      // Shopify does not allow creating orders via API with arbitrary order numbers
      // This is usually only done for draft orders or historical imports
      action = 'skipped';
      targetData = null;
      logger.warn('Cannot create orders in Shopify via API directly', {
        orderNumber,
      });
    }

    return {
      action,
      sourceData: oracleData,
      targetData,
    };
  }
}
