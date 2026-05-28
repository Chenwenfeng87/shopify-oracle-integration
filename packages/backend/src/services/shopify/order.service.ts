import axios from 'axios';
import { ShopifyClient } from './shopify-client';
import { logger } from '../../utils/logger';
import type { ShopifyOrder, ShopifyLineItem } from '@shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GetOrdersParams {
  limit?: number;
  page_info?: string;
  ids?: string;
  since_id?: number;
  created_at_min?: string;
  created_at_max?: string;
  updated_at_min?: string;
  updated_at_max?: string;
  processed_at_min?: string;
  processed_at_max?: string;
  financial_status?: string;
  fulfillment_status?: string;
  status?: 'open' | 'closed' | 'cancelled' | 'any';
  fields?: string;
  name?: string;
}

export interface OrderListResult {
  orders: ShopifyOrder[];
  nextPageInfo?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractNextPageInfo(linkHeader: string | undefined): string | undefined {
  if (!linkHeader) return undefined;
  const match = linkHeader.match(/<[^>]*page_info=([a-zA-Z0-9+\/=]+)[^>]*>;\s*rel="next"/);
  return match ? match[1] : undefined;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ShopifyOrderService {
  constructor(private readonly client: ShopifyClient) {}

  // -------------------------------------------------------------------------
  // Orders
  // -------------------------------------------------------------------------

  /**
   * Fetch orders with optional filtering.
   */
  async getOrders(params: GetOrdersParams = {}): Promise<ShopifyOrder[]> {
    const queryParams: Record<string, unknown> = {
      limit: Math.min(params.limit ?? 50, 250),
    };

    if (params.page_info) {
      queryParams.page_info = params.page_info;
    } else {
      if (params.ids) queryParams.ids = params.ids;
      if (params.since_id !== undefined) queryParams.since_id = params.since_id;
      if (params.created_at_min) queryParams.created_at_min = params.created_at_min;
      if (params.created_at_max) queryParams.created_at_max = params.created_at_max;
      if (params.updated_at_min) queryParams.updated_at_min = params.updated_at_min;
      if (params.updated_at_max) queryParams.updated_at_max = params.updated_at_max;
      if (params.processed_at_min) queryParams.processed_at_min = params.processed_at_min;
      if (params.processed_at_max) queryParams.processed_at_max = params.processed_at_max;
      if (params.financial_status) queryParams.financial_status = params.financial_status;
      if (params.fulfillment_status) queryParams.fulfillment_status = params.fulfillment_status;
      if (params.status) queryParams.status = params.status;
      if (params.fields) queryParams.fields = params.fields;
      if (params.name) queryParams.name = params.name;
    }

    const response = await this.client.get<{ orders: ShopifyOrder[] }>(
      '/orders.json',
      queryParams,
    );

    return response.orders || [];
  }

  /**
   * Get a single order by ID.
   */
  async getOrder(id: number): Promise<ShopifyOrder> {
    const response = await this.client.get<{ order: ShopifyOrder }>(
      `/orders/${id}.json`,
    );
    return response.order;
  }

  /**
   * Get orders filtered by financial status.
   * Common statuses: pending, authorized, partially_paid, paid, partially_refunded, refunded, voided.
   */
  async getOrdersByStatus(status: string): Promise<ShopifyOrder[]> {
    return this.getOrders({ financial_status: status, limit: 250 });
  }

  /**
   * Get orders that were updated after a specific date.
   */
  async getOrdersUpdatedAfter(date: Date): Promise<ShopifyOrder[]> {
    const updatedAtMin = date.toISOString();
    logger.info('Fetching orders updated after', { updatedAtMin });

    return this.getOrders({ updated_at_min: updatedAtMin, limit: 250 });
  }

  // -------------------------------------------------------------------------
  // Paginated listing (cursor-based)
  // -------------------------------------------------------------------------

  /**
   * Fetch a single page of orders using cursor-based pagination.
   * Returns the orders plus a `nextPageInfo` cursor for the next call.
   */
  async listOrdersPaginated(
    limit: number = 50,
    pageInfo?: string,
  ): Promise<OrderListResult> {
    const apiVersion = '2024-07';
    const url = `https://${this.client.storeDomain}/admin/api/${apiVersion}/orders.json`;

    const params: Record<string, unknown> = {
      limit: Math.min(limit, 250),
    };

    if (pageInfo) {
      params.page_info = pageInfo;
    }

    const response = await axios.get<{ orders: ShopifyOrder[] }>(url, {
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
      orders: response.data.orders || [],
      nextPageInfo,
    };
  }
}

export default ShopifyOrderService;
