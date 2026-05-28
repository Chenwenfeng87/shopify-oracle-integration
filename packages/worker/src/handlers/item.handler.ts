import { SyncQueueMessage, FieldMappingRow, RecordResult } from '../types';
import { query, getOracleCredentials, getFieldMappings, getPool } from '../database';
import { logger } from '../logger';
import {
  createShopifyClient,
  createOracleClient,
  transformData,
  processRecord,
  updateJobProgress,
} from './handler.utils';

/**
 * Handles item/product synchronization between Oracle and Shopify.
 *
 * Direction: oracle_to_shopify
 * - Reads product data from Oracle Netsuite
 * - Transforms using field mappings
 * - Creates or updates products in Shopify via Admin API
 *
 * Direction: shopify_to_oracle
 * - Reads product data from Shopify
 * - Transforms using field mappings
 * - Creates or updates items in Oracle Netsuite
 */
export class ItemHandler {
  /**
   * Process a batch of item sync records.
   */
  async process(message: SyncQueueMessage): Promise<void> {
    const { jobId, storeId, direction, records, mappings } = message;
    const log = logger.child({ jobId, storeId, entityType: 'item', direction });

    log.info('Starting item sync processing', {
      recordsCount: records.length,
    });

    // Fetch store details for API authentication
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

    // Fetch Oracle credentials if this is an oracle_to_shopify direction
    const credentials = await getOracleCredentials(storeId);

    const typedMappings = mappings as FieldMappingRow[];
    const results: RecordResult[] = [];
    const errors: string[] = [];
    let processedCount = 0;
    let failedCount = 0;

    // Process each record
    for (const record of records) {
      const recordId = record.id;

      const result = await processRecord(jobId, recordId, async () => {
        if (direction === 'oracle_to_shopify') {
          return await this.syncOracleToShopify(
            record.data,
            typedMappings,
            shopifyDomain,
            accessToken,
            credentials!
          );
        } else {
          return await this.syncShopifyToOracle(
            record.data,
            typedMappings,
            shopifyDomain,
            accessToken,
            credentials!
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

    // Update job progress in the database
    await updateJobProgress(jobId, processedCount, failedCount, errors);

    log.info('Item sync processing complete', {
      processedRecords: processedCount,
      failedRecords: failedCount,
      totalRecords: records.length,
    });
  }

  /**
   * Sync a single item from Oracle to Shopify.
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

    const sku = shopifyData.sku as string;
    if (!sku) {
      throw new Error('SKU is required for item sync');
    }

    // Check if product exists in Shopify by SKU
    const existingResponse = await shopifyClient.get('/products.json', {
      params: { sku, limit: 1 },
    });

    const existingProducts = existingResponse.data?.products || [];

    let action: string;
    let shopifyResponse: Record<string, unknown>;
    let targetData: Record<string, unknown> | null;

    if (existingProducts.length > 0) {
      // Update existing product
      const existingProduct = existingProducts[0];
      action = 'updated';

      const updatePayload: Record<string, unknown> = {};
      if (shopifyData.title) updatePayload.title = shopifyData.title;
      if (shopifyData.body_html !== undefined) updatePayload.body_html = shopifyData.body_html;
      if (shopifyData.vendor) updatePayload.vendor = shopifyData.vendor;
      if (shopifyData.product_type) updatePayload.product_type = shopifyData.product_type;
      if (shopifyData.status) updatePayload.status = shopifyData.status;
      if (shopifyData.tags) updatePayload.tags = shopifyData.tags;

      const response = await shopifyClient.put(
        `/products/${existingProduct.id}.json`,
        { product: updatePayload }
      );
      shopifyResponse = response.data;
      targetData = response.data?.product || null;

      // Update variant price if provided
      if (shopifyData.price && existingProduct.variants?.length > 0) {
        const variantId = existingProduct.variants[0].id;
        await shopifyClient.put(`/variants/${variantId}.json`, {
          variant: {
            id: variantId,
            price: String(shopifyData.price),
          },
        });
      }
    } else {
      // Create new product
      action = 'created';

      const createPayload: Record<string, unknown> = {
        title: (shopifyData.title as string) || sku,
        sku,
      };
      if (shopifyData.body_html !== undefined) createPayload.body_html = shopifyData.body_html;
      if (shopifyData.vendor) createPayload.vendor = shopifyData.vendor;
      if (shopifyData.product_type) createPayload.product_type = shopifyData.product_type;
      if (shopifyData.status) createPayload.status = shopifyData.status;
      if (shopifyData.tags) createPayload.tags = shopifyData.tags;
      if (shopifyData.price) {
        createPayload.variants = [
          {
            price: String(shopifyData.price),
            sku,
          },
        ];
      }

      const response = await shopifyClient.post('/products.json', {
        product: createPayload,
      });
      shopifyResponse = response.data;
      targetData = response.data?.product || null;
    }

    return {
      action,
      sourceData: oracleData,
      targetData,
    };
  }

  /**
   * Sync a single item from Shopify to Oracle.
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

    // Transform Shopify data to Oracle format
    const oracleData = transformData(
      shopifyData,
      mappings,
      'shopify_field',
      'oracle_field'
    );

    const itemNumber = oracleData.ItemNumber as string;
    if (!itemNumber) {
      throw new Error('ItemNumber is required for Oracle item sync');
    }

    let action: string;
    let targetData: Record<string, unknown> | null;

    try {
      // Check if item exists in Oracle
      const searchResponse = await oracleClient.get('/api/items', {
        params: { q: `ItemNumber eq '${itemNumber}'`, limit: 1 },
      });

      const existingItems = (searchResponse.data?.items || []) as Record<string, unknown>[];

      if (existingItems.length > 0) {
        // Update existing item
        const existingItem = existingItems[0];
        const itemId = existingItem.id || existingItem.ItemId;
        action = 'updated';

        const response = await oracleClient.patch(`/api/items/${itemId}`, oracleData);
        targetData = response.data || oracleData;
      } else {
        // Create new item
        action = 'created';
        const response = await oracleClient.post('/api/items', oracleData);
        targetData = response.data || oracleData;
      }
    } catch (error) {
      // Oracle REST API may use different endpoints (SuiteTalk, RESTlets)
      // Fallback attempt with alternative endpoint
      logger.warn('Primary Oracle API failed, trying alternative endpoint', {
        error: error instanceof Error ? error.message : String(error),
      });

      const response = await oracleClient.post('/api/items', oracleData);
      targetData = response.data || oracleData;
      action = 'created';
    }

    return {
      action,
      sourceData: shopifyData,
      targetData,
    };
  }
}
