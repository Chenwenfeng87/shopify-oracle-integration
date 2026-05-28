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
 * Handles price synchronization between Shopify and Oracle.
 *
 * Direction: shopify_to_oracle (primary)
 * - Reads product variant pricing from Shopify
 * - Transforms using field mappings
 * - Updates price records in Oracle Netsuite
 *
 * Direction: oracle_to_shopify
 * - Reads price data from Oracle
 * - Updates variant prices in Shopify
 */
export class PriceHandler {
  /**
   * Process a batch of price sync records.
   */
  async process(message: SyncQueueMessage): Promise<void> {
    const { jobId, storeId, direction, records, mappings } = message;
    const log = logger.child({ jobId, storeId, entityType: 'price', direction });

    log.info('Starting price sync processing', {
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

    log.info('Price sync processing complete', {
      processedRecords: processedCount,
      failedRecords: failedCount,
      totalRecords: records.length,
    });
  }

  /**
   * Sync pricing data from Shopify to Oracle.
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
    const shopifyClient = createShopifyClient(shopifyDomain, accessToken);
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
      throw new Error('ItemNumber/SKU is required for price sync');
    }

    // Fetch the full variant details from Shopify to ensure we have latest pricing
    let variantPrice = shopifyData.price as string;
    if (!variantPrice) {
      const variantResponse = await shopifyClient.get('/variants.json', {
        params: { sku: itemNumber, limit: 1 },
      });
      const variants = variantResponse.data?.variants || [];
      if (variants.length > 0) {
        variantPrice = variants[0].price;
      }
    }

    oracleData.UnitPrice = variantPrice || oracleData.UnitPrice;

    let action: string;
    let targetData: Record<string, unknown> | null;

    try {
      // Search for existing price record in Oracle
      const searchResponse = await oracleClient.get('/api/prices', {
        params: { q: `ItemNumber eq '${encodeURIComponent(itemNumber)}'`, limit: 1 },
      });

      const existingPrices = (searchResponse.data?.items || []) as Record<string, unknown>[];

      if (existingPrices.length > 0) {
        const existingPrice = existingPrices[0];
        const priceId = existingPrice.id || existingPrice.PriceId;
        action = 'updated';

        const response = await oracleClient.patch(`/api/prices/${priceId}`, oracleData);
        targetData = response.data || oracleData;
      } else {
        action = 'created';
        const response = await oracleClient.post('/api/prices', oracleData);
        targetData = response.data || oracleData;
      }
    } catch (error) {
      logger.warn('Primary Oracle price API failed, trying alternative', {
        error: error instanceof Error ? error.message : String(error),
      });

      const response = await oracleClient.post('/api/prices', oracleData);
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
   * Sync pricing data from Oracle to Shopify.
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
      throw new Error('SKU is required for price sync to Shopify');
    }

    // Find the product variant in Shopify by SKU
    const variantResponse = await shopifyClient.get('/variants.json', {
      params: { sku, limit: 1 },
    });

    const variants = variantResponse.data?.variants || [];

    if (variants.length === 0) {
      throw new Error(`Product variant with SKU ${sku} not found in Shopify`);
    }

    const variant = variants[0];
    const newPrice = String(shopifyData.price || oracleData.UnitPrice);

    const response = await shopifyClient.put(`/variants/${variant.id}.json`, {
      variant: {
        id: variant.id,
        price: newPrice,
        compare_at_price: shopifyData.compare_at_price
          ? String(shopifyData.compare_at_price)
          : undefined,
      },
    });

    return {
      action: 'updated',
      sourceData: oracleData,
      targetData: response.data?.variant || null,
    };
  }
}
