import { OracleClient, OracleClientError } from './oracle-client';
import { logger } from '../../utils/logger';
import type { OracleCustomer, OracleAddress } from '@shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GetCustomersParams {
  limit?: number;
  offset?: number;
  q?: string;
  partyType?: string;
  status?: string;
  email?: string;
  lastUpdateDate?: string;
  expand?: string;
  fields?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract customers from an Oracle paginated API response.
 */
function extractCustomers(response: unknown): { customers: OracleCustomer[]; total: number } {
  const body = response as Record<string, unknown>;

  const customers = (body.items as OracleCustomer[]) ||
    (body.customers as OracleCustomer[]) ||
    [];

  const total =
    (body.totalResults as number) ??
    (body.count as number) ??
    customers.length;

  return { customers, total };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class OracleCustomerService {
  constructor(private readonly client: OracleClient) {}

  // -------------------------------------------------------------------------
  // Customers
  // -------------------------------------------------------------------------

  /**
   * Get customers with optional filtering.
   * Oracle Fusion Cloud REST API: GET /api/customers
   */
  async getCustomers(params: GetCustomersParams = {}): Promise<OracleCustomer[]> {
    const queryParams: Record<string, unknown> = {};

    if (params.limit) queryParams.limit = params.limit;
    if (params.offset) queryParams.offset = params.offset;
    if (params.q) queryParams.q = params.q;
    if (params.partyType) queryParams.partyType = params.partyType;
    if (params.status) queryParams.status = params.status;
    if (params.email) queryParams.email = params.email;
    if (params.lastUpdateDate) queryParams.lastUpdateDate = params.lastUpdateDate;
    if (params.expand) queryParams.expand = params.expand;
    if (params.fields) queryParams.fields = params.fields;

    const response = await this.client.get<Record<string, unknown>>(
      '/api/customers',
      queryParams,
    );

    const { customers } = extractCustomers(response);
    return customers;
  }

  /**
   * Get a single customer by party ID.
   * Oracle Fusion Cloud REST API: GET /api/customers/{partyId}
   */
  async getCustomer(partyId: number): Promise<OracleCustomer> {
    const response = await this.client.get<Record<string, unknown>>(
      `/api/customers/${partyId}`,
    );

    const customer = (response.customer as OracleCustomer) ||
      (response.item as OracleCustomer) ||
      (response as unknown as OracleCustomer);

    return customer as OracleCustomer;
  }

  /**
   * Create a new customer (party) in Oracle Fusion Cloud.
   * Oracle Fusion Cloud REST API: POST /api/customers
   */
  async createCustomer(customer: Partial<OracleCustomer>): Promise<OracleCustomer> {
    logger.info('Creating Oracle customer', {
      partyName: customer.PartyName,
      email: customer.EmailAddress,
    });

    const response = await this.client.post<Record<string, unknown>>(
      '/api/customers',
      customer,
    );

    const created = (response.customer as OracleCustomer) ||
      (response.item as OracleCustomer) ||
      (response as unknown as OracleCustomer);

    return created as OracleCustomer;
  }

  /**
   * Update an existing customer in Oracle Fusion Cloud.
   * Oracle Fusion Cloud REST API: PATCH /api/customers/{partyId}
   */
  async updateCustomer(partyId: number, customer: Partial<OracleCustomer>): Promise<OracleCustomer> {
    logger.info('Updating Oracle customer', { partyId });

    const response = await this.client.patch<Record<string, unknown>>(
      `/api/customers/${partyId}`,
      customer,
    );

    const updated = (response.customer as OracleCustomer) ||
      (response.item as OracleCustomer) ||
      (response as unknown as OracleCustomer);

    return updated as OracleCustomer;
  }

  // -------------------------------------------------------------------------
  // Addresses
  // -------------------------------------------------------------------------

  /**
   * Create a new address for a customer.
   * Oracle Fusion Cloud REST API: POST /api/customers/{customerId}/addresses
   */
  async createAddress(
    customerId: number,
    address: Partial<OracleAddress>,
  ): Promise<OracleAddress> {
    logger.info('Creating Oracle customer address', {
      customerId,
      addressLine1: address.AddressLine1,
    });

    const response = await this.client.post<Record<string, unknown>>(
      `/api/customers/${customerId}/addresses`,
      address,
    );

    const created = (response.address as OracleAddress) ||
      (response.item as OracleAddress) ||
      (response as unknown as OracleAddress);

    return created as OracleAddress;
  }

  /**
   * Update an existing address.
   * Oracle Fusion Cloud REST API: PATCH /api/customers/addresses/{addressId}
   */
  async updateAddress(
    addressId: number,
    address: Partial<OracleAddress>,
  ): Promise<OracleAddress> {
    logger.info('Updating Oracle customer address', { addressId });

    const response = await this.client.patch<Record<string, unknown>>(
      `/api/customers/addresses/${addressId}`,
      address,
    );

    const updated = (response.address as OracleAddress) ||
      (response.item as OracleAddress) ||
      (response as unknown as OracleAddress);

    return updated as OracleAddress;
  }

  // -------------------------------------------------------------------------
  // Customer existence check
  // -------------------------------------------------------------------------

  /**
   * Find a customer by their PartyNumber.
   * In this integration, the PartyNumber is often set to the Shopify customer ID
   * as a string, enabling lookup when syncing from Shopify to Oracle.
   *
   * Returns the customer if found, or null if no match exists.
   */
  async findByPartyNumber(partyNumber: string): Promise<OracleCustomer | null> {
    logger.debug('Looking up Oracle customer by party number', { partyNumber });

    const response = await this.client.get<Record<string, unknown>>('/api/customers', {
      q: `PartyNumber eq '${partyNumber}'`,
      limit: 1,
    });

    const { customers } = extractCustomers(response);

    return customers.length > 0 ? customers[0] : null;
  }

  /**
   * Find a customer by email address.
   * Returns the customer if found, or null if no match exists.
   */
  async findByEmail(email: string): Promise<OracleCustomer | null> {
    logger.debug('Looking up Oracle customer by email', { email });

    const response = await this.client.get<Record<string, unknown>>('/api/customers', {
      q: `EmailAddress eq '${email}'`,
      limit: 1,
    });

    const { customers } = extractCustomers(response);

    return customers.length > 0 ? customers[0] : null;
  }

  /**
   * Determine if a customer exists and return them, or create a new one.
   * This is the recommended method for sync operations where you want to
   * create or update based on existence.
   *
   * @param customer - Customer data to create or update
   * @param partyNumber - Used to check existence (typically the Shopify customer ID)
   * @returns The existing or newly created customer, and whether it was created
   */
  async createOrUpdate(
    customer: Partial<OracleCustomer>,
    partyNumber: string,
  ): Promise<{ customer: OracleCustomer; created: boolean }> {
    // Check by PartyNumber first
    let existing = await this.findByPartyNumber(partyNumber);

    if (existing) {
      // Update the existing customer
      const updated = await this.updateCustomer(existing.PartyId, {
        ...customer,
        PartyId: existing.PartyId,
      });
      return { customer: updated, created: false };
    }

    // Check by email as a fallback
    if (customer.EmailAddress) {
      existing = await this.findByEmail(customer.EmailAddress);
      if (existing) {
        const updated = await this.updateCustomer(existing.PartyId, {
          ...customer,
          PartyId: existing.PartyId,
        });
        return { customer: updated, created: false };
      }
    }

    // Create new customer
    const created = await this.createCustomer({
      ...customer,
      PartyNumber: partyNumber,
    });

    return { customer: created, created: true };
  }
}

export default OracleCustomerService;
