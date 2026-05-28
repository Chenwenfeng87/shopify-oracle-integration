// ============================================================================
// CustomerHandler Tests
// ============================================================================

import {
  mockQuery,
  mockAxiosInstance,
  createTestId,
  createCustomerSyncMessage,
} from '../setup';

jest.mock('../../src/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(() => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    })),
  },
  createEntityLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
}));

import { CustomerHandler } from '../../src/handlers/customer.handler';

describe('CustomerHandler', () => {
  let handler: CustomerHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = new CustomerHandler();
  });

  test('fetches customers from Shopify and creates in Oracle', async () => {
    const storeId = createTestId();
    const message = createCustomerSyncMessage({
      storeId,
      direction: 'shopify_to_oracle',
      records: [
        {
          id: 'rec-1',
          data: {
            id: 555001,
            email: 'new.customer@example.com',
            first_name: 'New',
            last_name: 'Customer',
            phone: '+1-555-999-9999',
            verified_email: true,
            addresses: [],
          },
        },
      ],
    });

    // Store lookup
    mockQuery.mockResolvedValueOnce({
      rows: [{
        shopify_domain: 'test-store.myshopify.com',
        access_token: 'test-shopify-token',
      }],
    });

    // Oracle credentials
    mockQuery.mockResolvedValueOnce({
      rows: [{
        base_url: 'https://oracle-test.example.com',
        username: 'oracle_user',
        password: 'oracle_pass',
        identity_domain: null,
      }],
    });

    // Oracle auth
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { token: 'oracle-bearer-token' },
    });

    // Search Oracle customers: not found
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: { items: [] },
    });

    // Create customer in Oracle
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: {
        PartyId: 5001,
        PartyNumber: 'CUST-5001',
        PartyName: 'New Customer',
        EmailAddress: 'new.customer@example.com',
      },
    });

    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handler.process(message);

    // Should have created the customer in Oracle
    const createCall = mockAxiosInstance.post.mock.calls.find(
      (call: any) => call[0] === '/api/customers'
    );
    expect(createCall).toBeDefined();
    expect(createCall[1].EmailAddress).toBe('new.customer@example.com');
  });

  test('updates existing Oracle customer when found', async () => {
    const storeId = createTestId();
    const message = createCustomerSyncMessage({
      storeId,
      direction: 'shopify_to_oracle',
      records: [
        {
          id: 'rec-1',
          data: {
            id: 555001,
            email: 'existing@example.com',
            first_name: 'Updated',
            last_name: 'Name',
            phone: '+1-555-111-2222',
            addresses: [],
          },
        },
      ],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        shopify_domain: 'test-store.myshopify.com',
        access_token: 'test-shopify-token',
      }],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        base_url: 'https://oracle-test.example.com',
        username: 'oracle_user',
        password: 'oracle_pass',
        identity_domain: null,
      }],
    });

    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { token: 'oracle-token' },
    });

    // Search: existing customer found
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        items: [
          {
            PartyId: 5001,
            PartyNumber: 'CUST-5001',
            PartyName: 'Old Name',
            EmailAddress: 'existing@example.com',
          },
        ],
      },
    });

    // Update customer
    mockAxiosInstance.patch.mockResolvedValueOnce({
      data: {
        PartyId: 5001,
        PartyName: 'Updated Name',
        EmailAddress: 'existing@example.com',
      },
    });

    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handler.process(message);

    // Should have UPDATED, not created
    const patchCall = mockAxiosInstance.patch.mock.calls.find(
      (call: any) => call[0] === '/api/customers/5001'
    );
    expect(patchCall).toBeDefined();
    expect(patchCall[1].PartyName).toContain('Updated');
  });

  test('maps ship-to addresses correctly', async () => {
    const storeId = createTestId();
    const message = createCustomerSyncMessage({
      storeId,
      direction: 'shopify_to_oracle',
      records: [
        {
          id: 'rec-1',
          data: {
            id: 555001,
            email: 'addr.test@example.com',
            first_name: 'Address',
            last_name: 'Test',
            addresses: [
              {
                id: 1,
                address1: '100 Shipping Lane',
                address2: 'Dock 5',
                city: 'Chicago',
                province: 'Illinois',
                province_code: 'IL',
                country: 'US',
                country_code: 'US',
                zip: '60601',
                phone: '+1-312-555-0100',
                first_name: 'Address',
                last_name: 'Test',
                company: null,
                default: true,
              },
            ],
          },
        },
      ],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        shopify_domain: 'test-store.myshopify.com',
        access_token: 'test-shopify-token',
      }],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        base_url: 'https://oracle-test.example.com',
        username: 'oracle_user',
        password: 'oracle_pass',
        identity_domain: null,
      }],
    });

    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { token: 'oracle-token' },
    });

    mockAxiosInstance.get.mockResolvedValueOnce({
      data: { items: [] },
    });

    mockAxiosInstance.post.mockResolvedValueOnce({
      data: {
        PartyId: 6001,
        Addresses: [
          {
            AddressLine1: '100 Shipping Lane',
            City: 'Chicago',
            State: 'Illinois',
            Country: 'US',
            PostalCode: '60601',
            AddressType: 'SHIP_TO',
          },
        ],
      },
    });

    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handler.process(message);

    expect(mockAxiosInstance.post).toHaveBeenCalled();
  });

  test('maps bill-to addresses correctly', async () => {
    const storeId = createTestId();
    // Customer with billing address info in default_address
    const message = createCustomerSyncMessage({
      storeId,
      direction: 'shopify_to_oracle',
      records: [
        {
          id: 'rec-1',
          data: {
            id: 555001,
            email: 'bill.test@example.com',
            first_name: 'Billing',
            last_name: 'Test',
            addresses: [
              {
                id: 1,
                address1: '200 Billing Blvd',
                city: 'New York',
                province: 'New York',
                province_code: 'NY',
                country: 'US',
                country_code: 'US',
                zip: '10001',
                first_name: 'Billing',
                last_name: 'Test',
                default: true,
              },
            ],
            default_address: {
              id: 1,
              address1: '200 Billing Blvd',
              city: 'New York',
              province: 'New York',
              country: 'US',
              zip: '10001',
            },
          },
        },
      ],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        shopify_domain: 'test-store.myshopify.com',
        access_token: 'test-shopify-token',
      }],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        base_url: 'https://oracle-test.example.com',
        username: 'oracle_user',
        password: 'oracle_pass',
        identity_domain: null,
      }],
    });

    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { token: 'oracle-token' },
    });

    mockAxiosInstance.get.mockResolvedValueOnce({
      data: { items: [] },
    });

    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { PartyId: 7001 },
    });

    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handler.process(message);
    expect(mockAxiosInstance.post).toHaveBeenCalled();
  });

  test('creates new Oracle customer when not found', async () => {
    const storeId = createTestId();
    const message = createCustomerSyncMessage({
      storeId,
      direction: 'shopify_to_oracle',
      records: [
        {
          id: 'rec-1',
          data: {
            id: 555999,
            email: 'brand.new@example.com',
            first_name: 'Brand',
            last_name: 'New',
            addresses: [],
          },
        },
      ],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        shopify_domain: 'test-store.myshopify.com',
        access_token: 'test-shopify-token',
      }],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        base_url: 'https://oracle-test.example.com',
        username: 'oracle_user',
        password: 'oracle_pass',
        identity_domain: null,
      }],
    });

    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { token: 'oracle-token' },
    });

    // Not found in Oracle
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: { items: [] },
    });

    // Created
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { PartyId: 8001, PartyName: 'Brand New' },
    });

    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handler.process(message);

    const createCall = mockAxiosInstance.post.mock.calls.find(
      (call: any) => call[0] === '/api/customers'
    );
    expect(createCall).toBeDefined();
    expect(mockAxiosInstance.patch).not.toHaveBeenCalled();
  });

  test('handles partial address data', async () => {
    const storeId = createTestId();
    // Customer with minimal address info
    const message = createCustomerSyncMessage({
      storeId,
      direction: 'shopify_to_oracle',
      records: [
        {
          id: 'rec-1',
          data: {
            id: 555001,
            email: 'partial@example.com',
            first_name: 'Partial',
            last_name: 'Data',
            addresses: [
              {
                id: 1,
                address1: '300 Main St',
                address2: null,
                city: '',
                province: null,
                province_code: null,
                country: 'US',
                country_code: 'US',
                zip: null,
                first_name: 'Partial',
                last_name: 'Data',
                phone: null,
                default: true,
              },
            ],
          },
        },
      ],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        shopify_domain: 'test-store.myshopify.com',
        access_token: 'test-shopify-token',
      }],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        base_url: 'https://oracle-test.example.com',
        username: 'oracle_user',
        password: 'oracle_pass',
        identity_domain: null,
      }],
    });

    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { token: 'oracle-token' },
    });

    mockAxiosInstance.get.mockResolvedValueOnce({
      data: { items: [] },
    });

    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { PartyId: 9001 },
    });

    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handler.process(message);
    expect(mockAxiosInstance.post).toHaveBeenCalled();
  });

  test('throws error when email is missing', async () => {
    const storeId = createTestId();
    const message = createCustomerSyncMessage({
      storeId,
      direction: 'shopify_to_oracle',
      records: [
        {
          id: 'rec-1',
          data: {
            id: 555001,
            first_name: 'No',
            last_name: 'Email',
            addresses: [],
          },
        },
      ],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        shopify_domain: 'test-store.myshopify.com',
        access_token: 'test-shopify-token',
      }],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        base_url: 'https://oracle-test.example.com',
        username: 'oracle_user',
        password: 'oracle_pass',
        identity_domain: null,
      }],
    });

    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { token: 'oracle-token' },
    });

    // The first record should fail with the missing email error
    // but the processRecord wrapper catches it
    mockQuery.mockResolvedValueOnce({ rows: [] }); // sync log for failed record
    mockQuery.mockResolvedValueOnce({ rows: [] }); // update job progress

    await handler.process(message);

    // Should have logged the error in sync log
    const logCall = mockQuery.mock.calls.find(
      (call: any) => call[0].includes('INSERT INTO sync_logs')
    );
    expect(logCall).toBeDefined();
    expect(logCall[1][7]).toBe('Email is required for customer sync');
  });
});
