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
 * Handles inventory synchronization between Oracle and Shopify.
 *
 * Direction: oracle_to_shopify (primary)
 * - Reads inventory levels from Oracle Netsuite
 * - Transforms using field mappings
 * - Updates inventory quantities in Shopify via Inventory API
 *
 * Direction: shopify_to_oracle
 * - Reads inventory changes from Shopify
 * - Updates inventory levels in Oracle
 */
export class InventoryHandler {
  /**
   * Process a batch of inventory sync records.
   */
  async process(message: SyncQueueMessage): Promise<void> {
    const { jobId, storeId, direction, records, mappings } = message;
    const log = logger.child({ jobId, storeId, entityType: 'inventory', direction });

    log.info('Starting inventory sync processing', {
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
        if (direction === 'oracle_to_shopify') {
          return await this.syncOracleToShopify(
            record.data,
            typedMappings,
            shopifyDomain,
            accessToken,
            credentials
          );
        } else {
          return await this.syncShopifyToOracle(
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

    log.info('Inventory sync processing complete', {
      processedRecords: processedCount,
      failedRecords: failedCount,
      totalRecords: records.length,
    });
  }

  /**
   * Sync inventory level from Oracle to Shopify.
   *
   * Shopify inventory management requires:
   * 1. Finding the product variant by SKU
   * 2. Getting the inventory item ID from the variant
   * 3. Finding the location ID
   * 4. Setting inventory levels via the InventoryLevel API
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

    // Transform Oracle inventory data to Shopify format
    const shopifyData = transformData(
      oracleData,
      mappings,
      'oracle_field',
      'shopify_field'
    );

    const sku = shopifyData.sku as string;
    if (!sku) {
      throw new Error('SKU is required for inventory sync');
    }

    const newQuantity = shopifyData.inventory_quantity as number;
    if (newQuantity === undefined || newQuantity < 0) {
      throw new Error(`Valid inventory_quantity is required for SKU ${sku}`);
    }

    // Step 1: Find the product variant by SKU
    const variantResponse = await shopifyClient.get('/variants.json', {
      params: { sku, limit: 1 },
    });

    const variants = variantResponse.data?.variants || [];
    if (variants.length === 0) {
      throw new Error(`Product variant with SKU ${sku} not found in Shopify`);
    }

    const variant = variants[0];
    const inventoryItemId = variant.inventory_item_id;

    if (!inventoryItemId) {
      throw new Error(`Inventory item ID not found for variant ${variant.id}`);
    }

    // Step 2: Get inventory level to find the location ID
    const inventoryLevelResponse = await shopifyClient.get(
      `/inventory_levels.json`,
      {
        params: { inventory_item_ids: inventoryItemId },
      }
    );

    const inventoryLevels = inventoryLevelResponse.data?.inventory_levels || [];

    let locationId: number;

    if (inventoryLevels.length > 0) {
      locationId = inventoryLevels[0].location_id;
    } else {
      // No inventory level exists yet — fetch the first location
      const locationsResponse = await shopifyClient.get('/locations.json');
      const locations = locationsResponse.data?.locations || [];
      if (locations.length === 0) {
        throw new Error('No locations found in Shopify store');
      }
      locationId = locations[0].id;

      // Register the inventory item at this location first
      await shopifyClient.post('/inventory_levels.json', {
        location_id: locationId,
        inventory_item_id: inventoryItemId,
        available: newQuantity,
      });

      return {
        action: 'created',
        sourceData: oracleData,
        targetData: { inventory_item_id: inventoryItemId, location_id: locationId, available: newQuantity },
      };
    }

    // Step 3: Set the inventory level
    // Use the "set" endpoint which adjusts to an absolute value
    const response = await shopifyClient.post('/inventory_levels/set.json', {
      location_id: locationId,
      inventory_item_id: inventoryItemId,
      available: newQuantity,
    });

    return {
      action: 'updated',
      sourceData: oracleData,
      targetData: response.data?.inventory_level || {
        inventory_item_id: inventoryItemId,
        location_id: locationId,
        available: newQuantity,
      },
    };
  }

  /**
   * Sync inventory change from Shopify to Oracle.
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
      throw new Error('ItemNumber/SKU is required for inventory sync to Oracle');
    }

    let action: string;
    let targetData: Record<string, unknown> | null;

    try {
      // Search for existing inventory record in Oracle
      const searchResponse = await oracleClient.get('/api/inventory', {
        params: { q: `ItemNumber eq '${encodeURIComponent(itemNumber)}'`, limit: 1 },
      });

      const existingInventory = (searchResponse.data?.items || []) as Record<string, unknown>[];

      if (existingInventory.length > 0) {
        const existingRecord = existingInventory[0];
        const inventoryId = existingRecord.id || existingRecord.InventoryId;
        action = 'updated';

        const response = await oracleClient.patch(`/api/inventory/${inventoryId}`, oracleData);
        targetData = response.data || oracleData;
      } else {
        action = 'created';
        const response = await oracleClient.post('/api/inventory', oracleData);
        targetData = response.data || oracleData;
      }
    } catch (error) {
      logger.warn('Primary Oracle inventory API failed, trying alternative', {
        error: error instanceof Error ? error.message : String(error),
      });

      const response = await oracleClient.post('/api/inventory', oracleData);
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
