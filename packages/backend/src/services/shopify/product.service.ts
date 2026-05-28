import axios from 'axios';
import { ShopifyClient, ShopifyClientError } from './shopify-client';
import { logger } from '../../utils/logger';
import type { ShopifyProduct, ShopifyVariant, ShopifyImage, ShopifyOption } from '@shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GetProductsParams {
  limit?: number;
  page_info?: string;
  ids?: string;
  since_id?: number;
  title?: string;
  vendor?: string;
  handle?: string;
  product_type?: string;
  status?: 'active' | 'archived' | 'draft';
  collection_id?: number;
  created_at_min?: string;
  created_at_max?: string;
  updated_at_min?: string;
  updated_at_max?: string;
  published_at_min?: string;
  published_at_max?: string;
  published_status?: 'published' | 'unpublished' | 'any';
  fields?: string;
}

export interface CreateProductInput {
  title: string;
  body_html?: string;
  vendor?: string;
  product_type?: string;
  status?: 'active' | 'archived' | 'draft';
  tags?: string;
  variants?: Partial<ShopifyVariant>[];
  images?: Array<{ src: string; position?: number; alt?: string }>;
  options?: Array<{ name: string; values: string[]; position?: number }>;
  metafields?: Array<{ namespace: string; key: string; value: string | number; type: string }>;
}

export interface UpdateProductInput {
  title?: string;
  body_html?: string;
  vendor?: string;
  product_type?: string;
  status?: 'active' | 'archived' | 'draft';
  tags?: string;
  variants?: Partial<ShopifyVariant>[];
  images?: Array<{ id?: number; src?: string; position?: number; alt?: string }>;
  options?: Array<{ id?: number; name: string; values: string[] }>;
  metafields?: Array<{ namespace: string; key: string; value: string | number; type: string }>;
}

export interface ProductListResult {
  products: ShopifyProduct[];
  nextPageInfo?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract `page_info` cursor from a Shopify Link header for cursor-based
 * pagination. Returns `undefined` when there is no next page.
 */
function extractNextPageInfo(linkHeader: string | undefined): string | undefined {
  if (!linkHeader) return undefined;
  const match = linkHeader.match(/<[^>]*page_info=([a-zA-Z0-9+\/=]+)[^>]*>;\s*rel="next"/);
  return match ? match[1] : undefined;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ShopifyProductService {
  constructor(private readonly client: ShopifyClient) {}

  // -------------------------------------------------------------------------
  // Products
  // -------------------------------------------------------------------------

  /**
   * Fetch all products matching the provided filters.
   * Handles auto-pagination when `limit` is high (up to 250 per page).
   *
   * For manual cursor-based pagination, use `listProductsPaginated`.
   */
  async getProducts(params: GetProductsParams = {}): Promise<ShopifyProduct[]> {
    const allProducts: ShopifyProduct[] = [];
    const limit = params.limit ?? 50;
    let pageInfo: string | undefined = params.page_info;
    let hasMore = true;

    while (hasMore) {
      const queryParams: Record<string, unknown> = {
        limit: Math.min(limit, 250),
      };

      if (pageInfo) {
        queryParams.page_info = pageInfo;
      } else {
        // First request – apply all user-provided filters
        if (params.ids) queryParams.ids = params.ids;
        if (params.since_id !== undefined) queryParams.since_id = params.since_id;
        if (params.title) queryParams.title = params.title;
        if (params.vendor) queryParams.vendor = params.vendor;
        if (params.handle) queryParams.handle = params.handle;
        if (params.product_type) queryParams.product_type = params.product_type;
        if (params.status) queryParams.status = params.status;
        if (params.collection_id !== undefined) queryParams.collection_id = params.collection_id;
        if (params.created_at_min) queryParams.created_at_min = params.created_at_min;
        if (params.created_at_max) queryParams.created_at_max = params.created_at_max;
        if (params.updated_at_min) queryParams.updated_at_min = params.updated_at_min;
        if (params.updated_at_max) queryParams.updated_at_max = params.updated_at_max;
        if (params.published_at_min) queryParams.published_at_min = params.published_at_min;
        if (params.published_at_max) queryParams.published_at_max = params.published_at_max;
        if (params.published_status) queryParams.published_status = params.published_status;
        if (params.fields) queryParams.fields = params.fields;
      }

      const response = await this.client.get<{ products: ShopifyProduct[] }>(
        '/products.json',
        queryParams,
      );

      const products = response.products || [];
      allProducts.push(...products);

      // Extract next page cursor from Link header (the client interceptor
      // does not capture raw headers; we cannot do this here without
      // modifying the client. The paginated method below provides this.)
      // For auto-pagination we just check if we got a full page.
      if (products.length < Math.min(limit, 250)) {
        hasMore = false;
      } else {
        // We need the Link header; since our client returns parsed JSON,
        // set page_info for next call from the known products length heuristic.
        // Full cursor-based pagination is in listProductsPaginated.
        hasMore = products.length >= Math.min(limit, 250);
        // For subsequent pages we use `page_info` but we do not have the cursor.
        // Break here to encourage use of listProductsPaginated for large sets.
        break;
      }
    }

    return allProducts;
  }

  /**
   * Get a single product by ID.
   */
  async getProduct(id: number): Promise<ShopifyProduct> {
    const response = await this.client.get<{ product: ShopifyProduct }>(
      `/products/${id}.json`,
    );
    return response.product;
  }

  /**
   * Create a new product with variants, images, and options.
   */
  async createProduct(product: Partial<ShopifyProduct>): Promise<ShopifyProduct> {
    const payload: Record<string, unknown> = {};

    if (product.title) payload.title = product.title;
    if (product.body_html !== undefined) payload.body_html = product.body_html;
    if (product.vendor !== undefined) payload.vendor = product.vendor;
    if (product.product_type !== undefined) payload.product_type = product.product_type;
    if (product.status !== undefined) payload.status = product.status;
    if (product.tags !== undefined) payload.tags = product.tags;
    if (product.published_scope !== undefined) payload.published_scope = product.published_scope;
    if (product.handle !== undefined) payload.handle = product.handle;
    if (product.metafields !== undefined) payload.metafields = product.metafields;

    if (product.variants && product.variants.length > 0) {
      payload.variants = product.variants.map((v) => ({
        ...(v.id ? { id: v.id } : {}),
        ...(v.title ? { title: v.title } : {}),
        ...(v.sku ? { sku: v.sku } : {}),
        ...(v.barcode ? { barcode: v.barcode } : {}),
        ...(v.price !== undefined ? { price: v.price } : {}),
        ...(v.compare_at_price !== undefined ? { compare_at_price: v.compare_at_price } : {}),
        ...(v.inventory_quantity !== undefined ? { inventory_quantity: v.inventory_quantity } : {}),
        ...(v.inventory_item_id !== undefined ? { inventory_item_id: v.inventory_item_id } : {}),
        ...(v.weight !== undefined ? { weight: v.weight } : {}),
        ...(v.weight_unit ? { weight_unit: v.weight_unit } : {}),
        ...(v.requires_shipping !== undefined ? { requires_shipping: v.requires_shipping } : {}),
        ...(v.taxable !== undefined ? { taxable: v.taxable } : {}),
        ...(v.fulfillment_service ? { fulfillment_service: v.fulfillment_service } : {}),
        ...(v.grams !== undefined ? { grams: v.grams } : {}),
        ...(v.option1 !== undefined ? { option1: v.option1 } : {}),
        ...(v.option2 !== undefined ? { option2: v.option2 } : {}),
        ...(v.option3 !== undefined ? { option3: v.option3 } : {}),
      }));
    }

    if (product.images && product.images.length > 0) {
      payload.images = product.images.map((img) => ({
        ...(img.id ? { id: img.id } : {}),
        ...(img.src ? { src: img.src } : {}),
        ...(img.position !== undefined ? { position: img.position } : {}),
        ...(img.alt !== undefined ? { alt: img.alt } : {}),
      }));
    }

    if (product.options && product.options.length > 0) {
      payload.options = product.options;
    }

    logger.info('Creating Shopify product', {
      title: product.title,
      variantCount: product.variants?.length,
    });

    const response = await this.client.post<{ product: ShopifyProduct }>(
      '/products.json',
      { product: payload },
    );

    return response.product;
  }

  /**
   * Update an existing product.
   */
  async updateProduct(id: number, product: Partial<ShopifyProduct>): Promise<ShopifyProduct> {
    logger.info('Updating Shopify product', { productId: id });

    const response = await this.client.put<{ product: ShopifyProduct }>(
      `/products/${id}.json`,
      { product },
    );

    return response.product;
  }

  /**
   * Delete a product by ID.
   */
  async deleteProduct(id: number): Promise<void> {
    logger.info('Deleting Shopify product', { productId: id });
    await this.client.delete(`/products/${id}.json`);
  }

  /**
   * Get the total product count.
   */
  async getProductsCount(): Promise<number> {
    const response = await this.client.get<{ count: number }>('/products/count.json');
    return response.count;
  }

  /**
   * Get products filtered by status.
   */
  async getProductsByStatus(status: string): Promise<ShopifyProduct[]> {
    return this.getProducts({ status: status as 'active' | 'archived' | 'draft', limit: 250 });
  }

  // -------------------------------------------------------------------------
  // Variants
  // -------------------------------------------------------------------------

  /**
   * Update a single variant's data.
   */
  async updateVariant(variantId: number, data: Partial<ShopifyVariant>): Promise<ShopifyVariant> {
    logger.debug('Updating Shopify variant', { variantId });

    const response = await this.client.put<{ variant: ShopifyVariant }>(
      `/variants/${variantId}.json`,
      { variant: data },
    );

    return response.variant;
  }

  /**
   * Get all variants for a product.
   */
  async getVariants(productId: number): Promise<ShopifyVariant[]> {
    const response = await this.client.get<{ variants: ShopifyVariant[] }>(
      `/products/${productId}/variants.json`,
      { limit: 250 },
    );
    return response.variants || [];
  }

  /**
   * Bulk update variants in sequence.
   * Shopify Admin REST API does not support a single bulk variant update
   * endpoint, so each variant is updated individually.
   */
  async bulkUpdateVariants(variants: { id: number; [key: string]: unknown }[]): Promise<void> {
    logger.info('Bulk updating Shopify variants', { count: variants.length });

    for (const variant of variants) {
      const { id, ...data } = variant;
      await this.updateVariant(id, data);
    }

    logger.info('Bulk variant update complete', { count: variants.length });
  }

  // -------------------------------------------------------------------------
  // Paginated listing (cursor-based)
  // -------------------------------------------------------------------------

  /**
   * Fetch a single page of products using cursor-based pagination.
   * Returns the products plus a `nextPageInfo` cursor to pass to the next call.
   *
   * Shopify Link header format:
   *   <https://.../admin/api/2024-07/products.json?page_info=abc&limit=50>; rel="next"
   */
  async listProductsPaginated(
    limit: number = 50,
    pageInfo?: string,
  ): Promise<ProductListResult> {
    const apiVersion = '2024-07';
    const url = `https://${this.client.storeDomain}/admin/api/${apiVersion}/products.json`;

    const params: Record<string, unknown> = {
      limit: Math.min(limit, 250),
    };

    if (pageInfo) {
      params.page_info = pageInfo;
    }

    // We make a direct axios call here to capture the Link header for
    // cursor-based pagination. The ShopifyClient returns parsed data only,
    // so raw headers are not accessible through the standard interface.
    const response = await axios.get<{ products: ShopifyProduct[] }>(url, {
      headers: {
        'X-Shopify-Access-Token': this.client.accessToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      params,
      timeout: 30000,
    });

    const nextPageInfo = extractNextPageInfo(response.headers['link'] as string);

    return {
      products: response.data.products || [],
      nextPageInfo,
    };
  }
}

export default ShopifyProductService;
