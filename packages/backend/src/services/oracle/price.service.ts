import { OracleClient } from './oracle-client';
import { logger } from '../../utils/logger';
import type { OraclePrice, OracleBatchResponse } from '@shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GetPricesParams {
  limit?: number;
  offset?: number;
  itemId?: number;
  priceListId?: number;
  currencyCode?: string;
  activeFlag?: boolean;
  effectiveDate?: string;
  q?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract prices from an Oracle paginated API response.
 */
function extractPrices(response: unknown): { prices: OraclePrice[]; total: number } {
  const body = response as Record<string, unknown>;

  const prices = (body.items as OraclePrice[]) ||
    (body.prices as OraclePrice[]) ||
    [];

  const total =
    (body.totalResults as number) ??
    (body.count as number) ??
    prices.length;

  return { prices, total };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class OraclePriceService {
  constructor(private readonly client: OracleClient) {}

  // -------------------------------------------------------------------------
  // Prices
  // -------------------------------------------------------------------------

  /**
   * Get prices with optional filtering.
   * Oracle Fusion Cloud REST API: GET /api/prices
   *
   * Supports filtering by item ID, price list, and currency.
   */
  async getPrices(itemId?: number, priceListId?: number): Promise<OraclePrice[]> {
    const queryParams: Record<string, unknown> = {};

    if (itemId !== undefined) queryParams.itemId = itemId;
    if (priceListId !== undefined) queryParams.priceListId = priceListId;

    const response = await this.client.get<Record<string, unknown>>(
      '/api/prices',
      queryParams,
    );

    const { prices } = extractPrices(response);
    return prices;
  }

  /**
   * Get a single price record by its ID.
   */
  async getPrice(priceId: number): Promise<OraclePrice> {
    const response = await this.client.get<Record<string, unknown>>(
      `/api/prices/${priceId}`,
    );

    const price = (response.price as OraclePrice) ||
      (response.item as OraclePrice) ||
      (response as unknown as OraclePrice);

    return price as OraclePrice;
  }

  /**
   * Create a new price record in Oracle Fusion Cloud.
   * Oracle Fusion Cloud REST API: POST /api/prices
   */
  async createPrice(price: Partial<OraclePrice>): Promise<OraclePrice> {
    logger.info('Creating Oracle price', {
      itemId: price.ItemId,
      priceListId: price.PriceListId,
      unitPrice: price.UnitPrice,
    });

    const response = await this.client.post<Record<string, unknown>>(
      '/api/prices',
      price,
    );

    const created = (response.price as OraclePrice) ||
      (response.item as OraclePrice) ||
      (response as unknown as OraclePrice);

    return created as OraclePrice;
  }

  /**
   * Update an existing price record.
   * Oracle Fusion Cloud REST API: PATCH /api/prices/{priceId}
   */
  async updatePrice(priceId: number, price: Partial<OraclePrice>): Promise<OraclePrice> {
    logger.info('Updating Oracle price', { priceId });

    const response = await this.client.patch<Record<string, unknown>>(
      `/api/prices/${priceId}`,
      price,
    );

    const updated = (response.price as OraclePrice) ||
      (response.item as OraclePrice) ||
      (response as unknown as OraclePrice);

    return updated as OraclePrice;
  }

  /**
   * Bulk update prices using Oracle's batch operation endpoint.
   * This is more efficient than individual updates when syncing
   * multiple price changes from Shopify to Oracle.
   */
  async bulkUpdatePrices(prices: Partial<OraclePrice>[]): Promise<OracleBatchResponse> {
    logger.info('Bulk updating Oracle prices', { count: prices.length });

    const batchResponse = await this.client.batchOperation({
      items: prices as Record<string, unknown>[],
      batchSize: Math.min(prices.length, 100),
      operation: 'UPSERT',
    });

    logger.info('Oracle price bulk update complete', {
      processed: batchResponse.processedRecords,
      failed: batchResponse.failedRecords,
    });

    return batchResponse;
  }
}

export default OraclePriceService;
