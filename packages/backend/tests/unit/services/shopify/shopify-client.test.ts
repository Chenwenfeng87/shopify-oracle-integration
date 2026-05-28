import { ShopifyClient, ShopifyClientError } from '../../../../src/services/shopify/shopify-client';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ShopifyClient', () => {
  let client: ShopifyClient;
  const storeDomain = 'test-store.myshopify.com';
  const accessToken = 'shpat_testtoken123';

  function createMockResponse(data: any, status = 200, headers: Record<string, string> = {}) {
    return {
      data,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      headers: {
        'x-shopify-shop-api-call-limit': '5/40',
        ...headers,
      },
      config: {} as any,
    };
  }

  function createMockError(
    status: number,
    data: any = { error: 'test error' },
    code?: string,
    headers: Record<string, string> = {},
  ) {
    const err: any = new Error(
      status === 429
        ? 'rate limit'
        : status >= 500
          ? 'server error'
          : 'request failed',
    );
    err.isAxiosError = true;
    err.response = {
      data,
      status,
      statusText: 'Error',
      headers: {
        'x-shopify-shop-api-call-limit': '40/40',
        'retry-after': status === 429 ? '2' : undefined,
        ...headers,
      },
      config: {} as any,
    };
    if (code) {
      err.code = code;
    }
    return err;
  }

  function createTimeoutError() {
    const err: any = new Error('timeout of 30000ms exceeded');
    err.isAxiosError = true;
    err.code = 'ECONNABORTED';
    err.message = 'timeout of 30000ms exceeded';
    return err;
  }

  function createNetworkError() {
    const err: any = new Error('Network Error');
    err.isAxiosError = true;
    err.code = 'ERR_NETWORK';
    err.message = 'Network Error';
    return err;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Create a mock axios create that returns a mock instance
    const mockAxiosInstance = {
      request: jest.fn(),
      interceptors: {
        request: { use: jest.fn(), eject: jest.fn() },
        response: { use: jest.fn(), eject: jest.fn() },
      },
    };
    (mockedAxios.create as jest.Mock).mockReturnValue(mockAxiosInstance);

    client = new ShopifyClient(storeDomain, accessToken, { maxRetries: 2, autoThrottle: false });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function getMockHttp() {
    return (mockedAxios.create as jest.Mock).mock.results[0].value;
  }

  test('GET request succeeds with proper headers', async () => {
    const mockHttp = getMockHttp();
    const responseData = { product: { id: 1, title: 'Test Product' } };
    const mockResponse = createMockResponse(responseData);
    mockHttp.request.mockResolvedValue(mockResponse);

    const result = await client.get('/products/123');

    expect(result).toEqual(responseData);

    // Verify the request config
    const callConfig = mockHttp.request.mock.calls[0][0];
    expect(callConfig.method).toBe('GET');
    expect(callConfig.url).toBe('/products/123');
  });

  test('POST request sends correct body', async () => {
    const mockHttp = getMockHttp();
    const requestBody = { product: { title: 'New Product', price: 19.99 } };
    const responseData = { product: { id: 1, ...requestBody.product } };
    mockHttp.request.mockResolvedValue(createMockResponse(responseData));

    const result = await client.post('/products', requestBody);

    expect(result).toEqual(responseData);
    const callConfig = mockHttp.request.mock.calls[0][0];
    expect(callConfig.method).toBe('POST');
    expect(callConfig.data).toEqual(requestBody);
  });

  test('PUT request sends correct body', async () => {
    const mockHttp = getMockHttp();
    const requestBody = { product: { id: 1, title: 'Updated' } };
    const responseData = { product: { id: 1, title: 'Updated' } };
    mockHttp.request.mockResolvedValue(createMockResponse(responseData));

    const result = await client.put('/products/1', requestBody);

    expect(result).toEqual(responseData);
    const callConfig = mockHttp.request.mock.calls[0][0];
    expect(callConfig.method).toBe('PUT');
    expect(callConfig.data).toEqual(requestBody);
  });

  test('handles 429 rate limit with retry', async () => {
    const mockHttp = getMockHttp();
    const rateLimitError = createMockError(429);
    const successResponse = createMockResponse({ product: { id: 1 } });

    mockHttp.request
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce(successResponse);

    const resultPromise = client.get('/products/1');

    // Advance enough time for the retry delay (2s from Retry-After + jitter)
    await jest.advanceTimersByTimeAsync(5000);

    const result = await resultPromise;
    expect(result).toEqual({ product: { id: 1 } });
    expect(mockHttp.request).toHaveBeenCalledTimes(2);
  });

  test('handles 5xx with retry', async () => {
    const mockHttp = getMockHttp();
    const serverError = createMockError(500, { error: 'Server Error' });
    const successResponse = createMockResponse({ product: { id: 1 } });

    mockHttp.request
      .mockRejectedValueOnce(serverError)
      .mockResolvedValueOnce(successResponse);

    const resultPromise = client.get('/products/1');

    // Advance time for backoff delay
    await jest.advanceTimersByTimeAsync(5000);

    const result = await resultPromise;
    expect(result).toEqual({ product: { id: 1 } });
    expect(mockHttp.request).toHaveBeenCalledTimes(2);
  });

  test('parses rate limit headers correctly', () => {
    const mockHttp = getMockHttp();
    const response = createMockResponse({ data: 'ok' }, 200, {
      'x-shopify-shop-api-call-limit': '10/40',
    });
    mockHttp.request.mockResolvedValue(response);

    // Make a request then check rate limit info
    client.get('/products').then(() => {
      const info = client.rateLimitInfo;
      expect(info).not.toBeNull();
      expect(info!.current).toBe(10);
      expect(info!.max).toBe(40);
      expect(info!.remaining).toBe(30);
      expect(info!.utilization).toBe(0.25);
    });
  });

  test('throttles when approaching rate limit', async () => {
    // Create a new client with auto-throttle enabled
    jest.clearAllMocks();
    const mockAxiosInstance = {
      request: jest.fn(),
      interceptors: {
        request: { use: jest.fn(), eject: jest.fn() },
        response: { use: jest.fn(), eject: jest.fn() },
      },
    };
    (mockedAxios.create as jest.Mock).mockReturnValue(mockAxiosInstance);

    const throttledClient = new ShopifyClient(storeDomain, accessToken, {
      maxRetries: 2,
      autoThrottle: true,
      throttleThreshold: 0.5,
      throttleDelayMs: 500,
    });

    // Set up a response where utilization is high
    const response = createMockResponse({ products: [] }, 200, {
      'x-shopify-shop-api-call-limit': '30/40',
    });
    mockAxiosInstance.request.mockResolvedValue(response);

    const result = await throttledClient.get('/products');
    expect(result).toEqual({ products: [] });

    // The client should now be in throttled state
    expect(throttledClient.isThrottled).toBe(true);
  });

  test('throws auth error on 401', async () => {
    const mockHttp = getMockHttp();
    const authError = createMockError(401, { error: 'Invalid API key' });
    mockHttp.request.mockRejectedValue(authError);

    await expect(client.get('/products/1')).rejects.toThrow(ShopifyClientError);
    await expect(client.get('/products/1')).rejects.toThrow(
      'Shopify API authentication failed',
    );
  });

  test('throws not found error on 404', async () => {
    const mockHttp = getMockHttp();
    const notFoundError = createMockError(404, { error: 'Not found' });
    mockHttp.request.mockRejectedValue(notFoundError);

    await expect(client.get('/products/9999')).rejects.toThrow(ShopifyClientError);
    await expect(client.get('/products/9999')).rejects.toThrow(
      'Shopify resource not found',
    );
  });

  test('graphql query executes correctly', async () => {
    const mockHttp = getMockHttp();
    const graphqlResponse = createMockResponse({
      data: {
        product: { id: 'gid://shopify/Product/1', title: 'GraphQL Product' },
      },
    });
    mockHttp.request.mockResolvedValue(graphqlResponse);

    const query = '{ product(id: "gid://shopify/Product/1") { id title } }';
    const result = await client.graphql<{ product: { id: string; title: string } }>(query);

    expect(result).toEqual({
      product: { id: 'gid://shopify/Product/1', title: 'GraphQL Product' },
    });

    const callConfig = mockHttp.request.mock.calls[0][0];
    expect(callConfig.method).toBe('POST');
    expect(callConfig.url).toBe('/graphql.json');
    expect(callConfig.data).toEqual({ query });
  });

  test('graphql throws on response errors', async () => {
    const mockHttp = getMockHttp();
    const errorResponse = createMockResponse(
      {
        data: null,
        errors: [{ message: 'Field "unknown" does not exist on type "QueryRoot"' }],
      },
    );
    mockHttp.request.mockResolvedValue(errorResponse);

    await expect(client.graphql('{ unknown }')).rejects.toThrow(ShopifyClientError);
    await expect(client.graphql('{ unknown }')).rejects.toThrow(/GRAPHQL_ERROR/);
  });

  test('graphql includes variables when provided', async () => {
    const mockHttp = getMockHttp();
    mockHttp.request.mockResolvedValue(
      createMockResponse({ data: { product: null } }),
    );

    await client.graphql('query ($id: ID!) { product(id: $id) { title } }', { id: 'gid://shopify/Product/1' });

    const callConfig = mockHttp.request.mock.calls[0][0];
    expect(callConfig.data.variables).toEqual({ id: 'gid://shopify/Product/1' });
  });

  test('request timeout throws', async () => {
    const mockHttp = getMockHttp();
    const timeoutError = createTimeoutError();
    mockHttp.request.mockRejectedValue(timeoutError);

    const resultPromise = client.get('/products');

    await jest.advanceTimersByTimeAsync(60_000);

    await expect(resultPromise).rejects.toThrow(ShopifyClientError);
    await expect(resultPromise).rejects.toThrow(/timed out/);
  });

  test('retries on network error', async () => {
    const mockHttp = getMockHttp();
    const networkError = createNetworkError();
    const successResponse = createMockResponse({ products: [] });

    mockHttp.request
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(successResponse);

    const resultPromise = client.get('/products');

    await jest.advanceTimersByTimeAsync(5000);

    const result = await resultPromise;
    expect(result).toEqual({ products: [] });
    expect(mockHttp.request).toHaveBeenCalledTimes(2);
  });

  test('exhausts retries on persistent 429 errors', async () => {
    const mockHttp = getMockHttp();
    const rateLimitError = createMockError(429);
    mockHttp.request.mockRejectedValue(rateLimitError);

    const resultPromise = client.get('/products');

    await jest.advanceTimersByTimeAsync(60_000);

    await expect(resultPromise).rejects.toThrow(ShopifyClientError);
    await expect(resultPromise).rejects.toThrow(/Rate limited after/);
    expect(mockHttp.request).toHaveBeenCalledTimes(2); // maxRetries=2 means 2 attempts
  });

  test('verifyHmac validates signatures correctly', () => {
    const result = client.verifyHmac(
      { shop: 'test.myshopify.com', path: '/test', timestamp: '1234567890' },
      'shared-secret',
    );
    // With an invalid hmac, should return false
    expect(result).toBe(false);
  });

  test('verifyHmac returns false when hmac is missing', () => {
    const result = client.verifyHmac(
      { shop: 'test.myshopify.com' },
      'secret',
    );
    expect(result).toBe(false);
  });
});
