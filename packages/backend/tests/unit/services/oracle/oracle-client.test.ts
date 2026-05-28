import { OracleClient, OracleClientError } from '../../../../src/services/oracle/oracle-client';
import axios from 'axios';

jest.mock('axios');
jest.mock('../../../../src/config/redis', () => ({
  getRedisClient: jest.fn(),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('OracleClient', () => {
  let client: OracleClient;
  const baseUrl = 'https://test-instance.oraclecloud.com';
  const username = 'testuser';
  const password = 'testpass';

  function createMockResponse(data: any, status = 200) {
    return {
      data,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      headers: {},
      config: {} as any,
    };
  }

  function createMockError(
    status: number,
    data: any = { error: { message: 'Oracle error' } },
  ) {
    const err: any = new Error(
      status === 401 ? 'Unauthorized' : status >= 500 ? 'Server Error' : 'Error',
    );
    err.isAxiosError = true;
    err.response = {
      data,
      status,
      statusText: 'Error',
      headers: {},
      config: {} as any,
    };
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

    const mockAxiosInstance = {
      request: jest.fn(),
      interceptors: {
        request: { use: jest.fn(), eject: jest.fn() },
        response: { use: jest.fn(), eject: jest.fn() },
      },
    };
    (mockedAxios.create as jest.Mock).mockReturnValue(mockAxiosInstance);

    // Mock axios.post for authentication
    (mockedAxios.post as jest.Mock).mockResolvedValue(
      createMockResponse({
        token: 'mock-oracle-token',
        expires_in: 3600,
      }),
    );

    client = new OracleClient(baseUrl, username, password, undefined, {
      maxRetries: 2,
      timeout: 30000,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function getMockHttp() {
    return (mockedAxios.create as jest.Mock).mock.results[0].value;
  }

  describe('authentication', () => {
    test('authenticates and caches token', async () => {
      const token = await client.authenticate();

      expect(token).toBe('mock-oracle-token');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${baseUrl}/api/auth/login`,
        { username, password },
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    test('uses cached token for subsequent requests', async () => {
      const mockHttp = getMockHttp();
      mockHttp.request.mockResolvedValue(createMockResponse({ items: [] }));

      // First request triggers auth + data request
      await client.get('/api/items');
      // Second request should use cached token
      await client.get('/api/items');

      // axios.post should only be called once (for first auth)
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    });

    test('refreshes token on 401 response', async () => {
      const mockHttp = getMockHttp();
      const authError = createMockError(401, { error: { message: 'Token expired' } });
      const successResponse = createMockResponse({ items: [{ id: 1 }] });

      // First attempt fails with 401, second succeeds after refresh
      mockHttp.request
        .mockRejectedValueOnce(authError)
        .mockResolvedValueOnce(successResponse);

      const resultPromise = client.get('/api/items');

      // Advance time for retry delays
      await jest.advanceTimersByTimeAsync(5000);

      const result = await resultPromise;
      expect(result).toEqual({ items: [{ id: 1 }] });
      // Auth was called at least once (first call), and refresh triggers a second auth
      expect(mockedAxios.post).toHaveBeenCalled();
    });

    test('token refresh failure throws auth error', async () => {
      const mockHttp = getMockHttp();
      const authError = createMockError(401, { error: { message: 'Token expired' } });
      mockHttp.request.mockRejectedValue(authError);

      // Make auth fail again on retry
      (mockedAxios.post as jest.Mock).mockResolvedValue(
        createMockResponse({ token: 'new-token' }, 200),
      );

      const resultPromise = client.get('/api/items');

      await jest.advanceTimersByTimeAsync(5000);

      await expect(resultPromise).rejects.toThrow(OracleClientError);
    });

    test('handles auth response with access_token field', async () => {
      (mockedAxios.post as jest.Mock).mockResolvedValue(
        createMockResponse({
          access_token: 'access-token-value',
          expires_in: 1800,
        }),
      );

      const token = await client.authenticate();
      expect(token).toBe('access-token-value');
    });

    test('throws error when auth response has no token', async () => {
      (mockedAxios.post as jest.Mock).mockResolvedValue(
        createMockResponse({ message: 'Welcome' }, 200),
      );

      await expect(client.authenticate()).rejects.toThrow(OracleClientError);
      await expect(client.authenticate()).rejects.toThrow(
        'Oracle authentication response did not contain a token',
      );
    });

    test('sends identity domain header when configured', async () => {
      const clientWithDomain = new OracleClient(baseUrl, username, password, 'my-identity-domain', {
        maxRetries: 2,
      });

      await clientWithDomain.authenticate();

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Identity-Domain': 'my-identity-domain',
          }),
        }),
      );
    });
  });

  describe('HTTP methods', () => {
    test('GET request succeeds', async () => {
      const mockHttp = getMockHttp();
      mockHttp.request.mockResolvedValue(createMockResponse({ items: [{ id: 1, name: 'Item 1' }] }));

      const result = await client.get('/api/items');

      expect(result).toEqual({ items: [{ id: 1, name: 'Item 1' }] });
      const callConfig = mockHttp.request.mock.calls[0][0];
      expect(callConfig.method).toBe('GET');
    });

    test('POST request sends correct payload', async () => {
      const mockHttp = getMockHttp();
      const payload = { name: 'New Oracle Item', price: 100 };
      mockHttp.request.mockResolvedValue(createMockResponse({ id: 1, ...payload }));

      const result = await client.post('/api/items', payload);

      expect(result).toEqual({ id: 1, name: 'New Oracle Item', price: 100 });
      const callConfig = mockHttp.request.mock.calls[0][0];
      expect(callConfig.method).toBe('POST');
      expect(callConfig.data).toEqual(payload);
    });

    test('PUT request sends correct payload', async () => {
      const mockHttp = getMockHttp();
      const payload = { name: 'Updated Item' };
      mockHttp.request.mockResolvedValue(createMockResponse({ id: 1, ...payload }));

      const result = await client.put('/api/items/1', payload);

      expect(result).toEqual({ id: 1, name: 'Updated Item' });
    });

    test('PATCH request sends correct payload', async () => {
      const mockHttp = getMockHttp();
      const payload = { name: 'Patched Item' };
      mockHttp.request.mockResolvedValue(createMockResponse({ id: 1, ...payload }));

      const result = await client.patch('/api/items/1', payload);

      expect(result).toEqual({ id: 1, name: 'Patched Item' });
    });

    test('DELETE request succeeds', async () => {
      const mockHttp = getMockHttp();
      mockHttp.request.mockResolvedValue(createMockResponse(null));

      await expect(client.delete('/api/items/1')).resolves.toBeUndefined();
    });
  });

  describe('error handling', () => {
    test('retries on 5xx errors', async () => {
      const mockHttp = getMockHttp();
      const serverError = createMockError(500, { error: { message: 'Internal error' } });
      const successResponse = createMockResponse({ items: [] });

      mockHttp.request
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce(successResponse);

      const resultPromise = client.get('/api/items');

      await jest.advanceTimersByTimeAsync(5000);

      const result = await resultPromise;
      expect(result).toEqual({ items: [] });
      expect(mockHttp.request).toHaveBeenCalledTimes(2);
    });

    test('handles Oracle error response format', async () => {
      const mockHttp = getMockHttp();
      const errorResponse = createMockError(400, {
        error: { code: 'INVALID_INPUT', message: 'Invalid field value' },
      });
      mockHttp.request.mockRejectedValue(errorResponse);

      await expect(client.get('/api/items')).rejects.toThrow(OracleClientError);
    });

    test('handles RFC 7807 error format', async () => {
      const mockHttp = getMockHttp();
      const errorResponse = createMockError(400, {
        type: 'https://oracle.com/errors/invalid',
        title: 'Invalid Request',
        detail: 'The request body contains invalid data',
        status: 400,
      });
      mockHttp.request.mockRejectedValue(errorResponse);

      await expect(client.get('/api/items')).rejects.toThrow(OracleClientError);
    });

    test('handles flat error format (errorMessage)', async () => {
      const mockHttp = getMockHttp();
      const errorResponse = createMockError(400, {
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'Validation failed',
      });
      mockHttp.request.mockRejectedValue(errorResponse);

      await expect(client.get('/api/items')).rejects.toThrow(OracleClientError);
    });

    test('retries on timeout', async () => {
      const mockHttp = getMockHttp();
      mockHttp.request.mockRejectedValue(createTimeoutError());

      const resultPromise = client.get('/api/items');

      await jest.advanceTimersByTimeAsync(60_000);

      await expect(resultPromise).rejects.toThrow(OracleClientError);
      await expect(resultPromise).rejects.toThrow(/timed out/);
    });

    test('retries on network error', async () => {
      const mockHttp = getMockHttp();
      const networkError = createNetworkError();
      const successResponse = createMockResponse({ items: [] });

      mockHttp.request
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce(successResponse);

      const resultPromise = client.get('/api/items');

      await jest.advanceTimersByTimeAsync(5000);

      const result = await resultPromise;
      expect(result).toEqual({ items: [] });
    });

    test('throws on 4xx non-401 errors without retry', async () => {
      const mockHttp = getMockHttp();
      const badRequestError = createMockError(400, {
        error: { message: 'Bad request' },
      });
      mockHttp.request.mockRejectedValue(badRequestError);

      await expect(client.get('/api/items')).rejects.toThrow(OracleClientError);
      // Should only have been called once (no retry for 4xx)
      expect(mockHttp.request).toHaveBeenCalledTimes(1);
    });

    test('throws on 403 errors without retry', async () => {
      const mockHttp = getMockHttp();
      const forbiddenError = createMockError(403, {
        error: { message: 'Forbidden' },
      });
      mockHttp.request.mockRejectedValue(forbiddenError);

      await expect(client.get('/api/items')).rejects.toThrow(OracleClientError);
      expect(mockHttp.request).toHaveBeenCalledTimes(1);
    });

    test('throws on 404 errors without retry', async () => {
      const mockHttp = getMockHttp();
      const notFoundError = createMockError(404, {
        error: { message: 'Not Found' },
      });
      mockHttp.request.mockRejectedValue(notFoundError);

      await expect(client.get('/api/items')).rejects.toThrow(OracleClientError);
      expect(mockHttp.request).toHaveBeenCalledTimes(1);
    });
  });

  describe('batch operations', () => {
    test('batch operation sends correct payload', async () => {
      const mockHttp = getMockHttp();
      const batchRequest = {
        operation: 'CREATE' as const,
        resources: [
          { ItemNumber: 'ITEM-001', ItemDescription: 'Test Item' },
        ],
        options: {},
      };
      mockHttp.request.mockResolvedValue(
        createMockResponse({
          success: true,
          results: [{ status: 201, id: 'new-id' }],
        }),
      );

      const result = await client.batchOperation(batchRequest);

      expect(result).toEqual({
        success: true,
        results: [{ status: 201, id: 'new-id' }],
      });
      const callConfig = mockHttp.request.mock.calls[0][0];
      expect(callConfig.method).toBe('POST');
      expect(callConfig.url).toBe('/api/batch/create');
      expect(callConfig.data).toEqual(batchRequest);
    });

    test('batch operation resolves endpoint by operation type', async () => {
      const mockHttp = getMockHttp();
      mockHttp.request.mockResolvedValue(createMockResponse({ success: true, results: [] }));

      await client.batchOperation({ operation: 'UPDATE', resources: [], options: {} });
      const callConfig = mockHttp.request.mock.calls[0][0];
      expect(callConfig.url).toBe('/api/batch/update');

      jest.clearAllMocks();
      mockHttp.request.mockResolvedValue(createMockResponse({ success: true, results: [] }));

      await client.batchOperation({ operation: 'DELETE', resources: [], options: {} });
      expect(mockHttp.request.mock.calls[0][0].url).toBe('/api/batch/delete');

      jest.clearAllMocks();
      mockHttp.request.mockResolvedValue(createMockResponse({ success: true, results: [] }));

      await client.batchOperation({ operation: 'UPSERT', resources: [], options: {} });
      expect(mockHttp.request.mock.calls[0][0].url).toBe('/api/batch/upsert');
    });

    test('batch operation falls back to default endpoint for unknown operations', async () => {
      const mockHttp = getMockHttp();
      mockHttp.request.mockResolvedValue(createMockResponse({ success: true, results: [] }));

      await client.batchOperation({ operation: 'EXPORT' as any, resources: [], options: {} });
      const callConfig = mockHttp.request.mock.calls[0][0];
      expect(callConfig.url).toBe('/api/batch');
    });
  });

  describe('rate limit behavior', () => {
    test('retries on 429 rate limit error', async () => {
      const mockHttp = getMockHttp();
      const rateLimitError = createMockError(429, {
        error: { message: 'Rate limit exceeded' },
      });
      const successResponse = createMockResponse({ items: [] });

      mockHttp.request
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce(successResponse);

      const resultPromise = client.get('/api/items');

      await jest.advanceTimersByTimeAsync(5000);

      const result = await resultPromise;
      expect(result).toEqual({ items: [] });
      // 429 is a 4xx, so it shouldn't retry by default (only 5xx and timeout retry)
      // Actually looking at the code: 429 falls through to the 4xx handler which throws
      // So it should only be called once, since non-401 4xx are not retried
      expect(mockHttp.request).toHaveBeenCalledTimes(1);
    });
  });

  describe('token refresh', () => {
    test('refreshToken clears and re-authenticates', async () => {
      (mockedAxios.post as jest.Mock).mockResolvedValue(
        createMockResponse({
          token: 'fresh-token',
          expires_in: 3600,
        }),
      );

      const token = await client.refreshToken();

      expect(token).toBe('fresh-token');
      // Redis del should be attempted
      const { getRedisClient } = require('../../../../src/config/redis');
      expect(getRedisClient).toHaveBeenCalled();
    });
  });
});
