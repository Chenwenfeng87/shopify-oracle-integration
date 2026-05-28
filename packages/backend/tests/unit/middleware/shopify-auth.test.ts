import { shopifyAuth } from '../../../src/middleware/shopify-auth';
import { config } from '../../../src/config/app.config';
import jwt from 'jsonwebtoken';

jest.mock('../../../src/config/app.config', () => ({
  config: {
    shopify: {
      apiKey: 'test-api-key',
      apiSecret: 'test-api-secret',
    },
  },
}));

describe('Shopify Auth Middleware', () => {
  let req: any;
  let res: any;
  let next: jest.Mock;

  beforeEach(() => {
    req = {
      path: '/api/some-route',
      headers: {},
      requestId: 'req-123',
      log: {
        debug: jest.fn(),
      },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  test('passes with valid JWT token', () => {
    const decodedPayload = {
      iss: 'https://test-store.myshopify.com/admin',
      dest: 'https://test-store.myshopify.com',
      aud: 'test-api-key',
      sub: 'test-store.myshopify.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      nbf: Math.floor(Date.now() / 1000) - 60,
      iat: Math.floor(Date.now() / 1000) - 60,
      jti: 'unique-token-id',
      sid: 'session-id-123',
    };

    const token = jwt.sign(decodedPayload, 'test-api-secret', { algorithm: 'HS256' });
    req.headers.authorization = `Bearer ${token}`;

    shopifyAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.storeId).toBe('test-store');
    expect(req.shopifyDomain).toBe('test-store.myshopify.com');
  });

  test('rejects with 401 when no token provided', () => {
    shopifyAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'AUTH_REQUIRED',
        }),
      }),
    );
  });

  test('rejects with 401 when token is invalid', () => {
    req.headers.authorization = 'Bearer invalid-token-here';

    shopifyAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'INVALID_TOKEN',
        }),
      }),
    );
  });

  test('rejects with 401 when token is expired', () => {
    const expiredPayload = {
      iss: 'https://test-store.myshopify.com/admin',
      dest: 'https://test-store.myshopify.com',
      aud: 'test-api-key',
      sub: 'test-store.myshopify.com',
      exp: Math.floor(Date.now() / 1000) - 3600,
      nbf: Math.floor(Date.now() / 1000) - 7200,
      iat: Math.floor(Date.now() / 1000) - 7200,
      jti: 'expired-token-id',
      sid: 'session-id-expired',
    };

    const token = jwt.sign(expiredPayload, 'test-api-secret', { algorithm: 'HS256' });
    req.headers.authorization = `Bearer ${token}`;

    shopifyAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'TOKEN_EXPIRED',
        }),
      }),
    );
  });

  test('attaches storeId to request on success', () => {
    const payload = {
      dest: 'https://my-shop.myshopify.com',
      aud: 'test-api-key',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = jwt.sign(payload, 'test-api-secret', { algorithm: 'HS256' });
    req.headers.authorization = `Bearer ${token}`;

    shopifyAuth(req, res, next);

    expect(req.storeId).toBe('my-shop');
  });

  test('attaches shopifyDomain to request on success', () => {
    const payload = {
      dest: 'https://my-shop.myshopify.com',
      aud: 'test-api-key',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = jwt.sign(payload, 'test-api-secret', { algorithm: 'HS256' });
    req.headers.authorization = `Bearer ${token}`;

    shopifyAuth(req, res, next);

    expect(req.shopifyDomain).toBe('my-shop.myshopify.com');
  });

  test('rejects with 401 on malformed auth header (no Bearer prefix)', () => {
    req.headers.authorization = 'Token something';

    shopifyAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'INVALID_AUTH_FORMAT',
        }),
      }),
    );
  });

  test('rejects with 401 on auth header with only one part', () => {
    req.headers.authorization = 'Bearer';

    shopifyAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'INVALID_AUTH_FORMAT',
        }),
      }),
    );
  });

  test('skips auth for webhook routes', () => {
    req.path = '/api/webhook/receive/products';

    shopifyAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('skips auth for GDPR routes', () => {
    const gdprPaths = [
      '/api/gdpr/customers/data_request',
      '/api/gdpr/customers/redact',
      '/api/gdpr/shop/redact',
    ];

    for (const path of gdprPaths) {
      req.path = path;
      next.mockClear();
      shopifyAuth(req, res, next);
      expect(next).toHaveBeenCalledWith();
    }
  });

  test('skips auth for health endpoint', () => {
    req.path = '/health';

    shopifyAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('skips auth for OAuth callback', () => {
    req.path = '/api/auth/callback';

    shopifyAuth(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test('skips auth for OAuth install', () => {
    req.path = '/api/auth/install';

    shopifyAuth(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test('rejects token signed with wrong secret', () => {
    const payload = {
      dest: 'https://test-store.myshopify.com',
      aud: 'test-api-key',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    // Sign with wrong secret
    const token = jwt.sign(payload, 'wrong-secret', { algorithm: 'HS256' });
    req.headers.authorization = `Bearer ${token}`;

    shopifyAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'INVALID_TOKEN',
        }),
      }),
    );
  });
});
