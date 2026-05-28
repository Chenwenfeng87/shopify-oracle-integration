import { ShopifyClient } from './shopify-client';
import { logger } from '../../utils/logger';
import type { ShopifyPriceRule, ShopifyVariant } from '@shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GetPriceRulesParams {
  limit?: number;
  page_info?: string;
  since_id?: number;
  created_at_min?: string;
  created_at_max?: string;
  updated_at_min?: string;
  updated_at_max?: string;
  status?: 'active' | 'expired' | 'scheduled';
  fields?: string;
}

export interface VariantPriceInfo {
  variantId: number;
  price: string;
  compareAtPrice: string | null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ShopifyPriceService {
  constructor(private readonly client: ShopifyClient) {}

  // -------------------------------------------------------------------------
  // Price Rules
  // -------------------------------------------------------------------------

  /**
   * Get price rules with optional filtering.
   *
   * Price rules are used for discounts; this is useful when syncing
   * Oracle price lists to Shopify discount/price rule structures.
   */
  async getPriceRules(params: GetPriceRulesParams = {}): Promise<ShopifyPriceRule[]> {
    const queryParams: Record<string, unknown> = {
      limit: Math.min(params.limit ?? 50, 250),
    };

    if (params.page_info) {
      queryParams.page_info = params.page_info;
    } else {
      if (params.since_id !== undefined) queryParams.since_id = params.since_id;
      if (params.created_at_min) queryParams.created_at_min = params.created_at_min;
      if (params.created_at_max) queryParams.created_at_max = params.created_at_max;
      if (params.updated_at_min) queryParams.updated_at_min = params.updated_at_min;
      if (params.updated_at_max) queryParams.updated_at_max = params.updated_at_max;
      if (params.status) queryParams.status = params.status;
      if (params.fields) queryParams.fields = params.fields;
    }

    const response = await this.client.get<{ price_rules: ShopifyPriceRule[] }>(
      '/price_rules.json',
      queryParams,
    );

    return response.price_rules || [];
  }

  // -------------------------------------------------------------------------
  // Variant Prices
  // -------------------------------------------------------------------------

  /**
   * Get prices for all variants of a specific product.
   */
  async getProductVariantPrices(productId: number): Promise<VariantPriceInfo[]> {
    const response = await this.client.get<{ variants: ShopifyVariant[] }>(
      `/products/${productId}/variants.json`,
      { limit: 250, fields: 'id,price,compare_at_price' },
    );

    const variants = response.variants || [];

    return variants.map((v) => ({
      variantId: v.id,
      price: v.price,
      compareAtPrice: v.compare_at_price,
    }));
  }

  /**
   * Update the price (and optionally compare-at price) for a specific variant.
   */
  async updateVariantPrice(
    variantId: number,
    price: string,
    compareAtPrice?: string,
  ): Promise<ShopifyVariant> {
    logger.info('Updating variant price', {
      variantId,
      price,
      hasCompareAt: compareAtPrice !== undefined,
    });

    const payload: Record<string, unknown> = { price };

    if (compareAtPrice !== undefined) {
      payload.compare_at_price = compareAtPrice;
    }

    const response = await this.client.put<{ variant: ShopifyVariant }>(
      `/variants/${variantId}.json`,
      { variant: payload },
    );

    return response.variant;
  }

  /**
   * Get the current price and compare-at price for a single variant.
   */
  async getVariantPrice(variantId: number): Promise<{ price: string; compareAtPrice: string | null }> {
    const response = await this.client.get<{ variant: ShopifyVariant }>(
      `/variants/${variantId}.json`,
      { fields: 'id,price,compare_at_price' },
    );

    return {
      price: response.variant.price,
      compareAtPrice: response.variant.compare_at_price,
    };
  }
}

export default ShopifyPriceService;
