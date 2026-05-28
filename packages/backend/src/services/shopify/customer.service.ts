import axios from 'axios';
import { ShopifyClient } from './shopify-client';
import { logger } from '../../utils/logger';
import type { ShopifyCustomer, ShopifyAddress } from '@shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GetCustomersParams {
  limit?: number;
  page_info?: string;
  ids?: string;
  since_id?: number;
  created_at_min?: string;
  created_at_max?: string;
  updated_at_min?: string;
  updated_at_max?: string;
  fields?: string;
}

export interface CustomerListResult {
  customers: ShopifyCustomer[];
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

export class ShopifyCustomerService {
  constructor(private readonly client: ShopifyClient) {}

  // -------------------------------------------------------------------------
  // Customers
  // -------------------------------------------------------------------------

  /**
   * Fetch customers with optional filtering.
   */
  async getCustomers(params: GetCustomersParams = {}): Promise<ShopifyCustomer[]> {
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
      if (params.fields) queryParams.fields = params.fields;
    }

    const response = await this.client.get<{ customers: ShopifyCustomer[] }>(
      '/customers.json',
      queryParams,
    );

    return response.customers || [];
  }

  /**
   * Get a single customer by ID.
   */
  async getCustomer(id: number): Promise<ShopifyCustomer> {
    const response = await this.client.get<{ customer: ShopifyCustomer }>(
      `/customers/${id}.json`,
    );
    return response.customer;
  }

  /**
   * Search customers by query string.
   * Shopify customer search supports: email, name, phone, etc.
   */
  async searchCustomers(query: string): Promise<ShopifyCustomer[]> {
    logger.debug('Searching Shopify customers', { query });

    const response = await this.client.get<{ customers: ShopifyCustomer[] }>(
      '/customers/search.json',
      { query, limit: 50 },
    );

    return response.customers || [];
  }

  /**
   * Get all addresses for a customer.
   */
  async getCustomerAddresses(customerId: number): Promise<ShopifyAddress[]> {
    const response = await this.client.get<{ addresses: ShopifyAddress[] }>(
      `/customers/${customerId}/addresses.json`,
    );

    return response.addresses || [];
  }

  // -------------------------------------------------------------------------
  // Paginated listing (cursor-based)
  // -------------------------------------------------------------------------

  /**
   * Fetch a single page of customers using cursor-based pagination.
   * Returns the customers plus a `nextPageInfo` cursor for the next call.
   */
  async listCustomersPaginated(
    limit: number = 50,
    pageInfo?: string,
  ): Promise<CustomerListResult> {
    const apiVersion = '2024-07';
    const url = `https://${this.client.storeDomain}/admin/api/${apiVersion}/customers.json`;

    const params: Record<string, unknown> = {
      limit: Math.min(limit, 250),
    };

    if (pageInfo) {
      params.page_info = pageInfo;
    }

    const response = await axios.get<{ customers: ShopifyCustomer[] }>(url, {
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
      customers: response.data.customers || [],
      nextPageInfo,
    };
  }
}

export default ShopifyCustomerService;
