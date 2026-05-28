import { errorHandler } from '../../../src/middleware/error-handler';
import { ZodError, z } from 'zod';

// Mock logger to suppress output
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock config
jest.mock('../../../src/config/app.config', () => ({
  config: {
    isDevelopment: false,
    isProduction: true,
    nodeEnv: 'test',
  },
}));

describe('Error Handler Middleware', () => {
  let req: any;
  let res: any;
  let next: jest.Mock;

  beforeEach(() => {
    req = {
      path: '/api/test',
      method: 'GET',
      requestId: 'req-456',
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  function invokeErrorHandler(err: Error): void {
    errorHandler(err, req, res, next);
  }

  test('returns 400 for Zod validation errors', () => {
    const schema = z.object({ name: z.string().min(1) });
    let zodError: ZodError;
    try {
      schema.parse({ name: '' });
    } catch (err) {
      zodError = err as ZodError;
      invokeErrorHandler(zodError);
    }

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: expect.any(Array),
        }),
        meta: expect.objectContaining({
          requestId: 'req-456',
        }),
      }),
    );
  });

  test('returns 401 for auth errors', () => {
    invokeErrorHandler(new Error('unauthorized access'));

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        }),
      }),
    );
  });

  test('returns 401 for AUTH_FAILED error', () => {
    invokeErrorHandler(new Error('AUTH_FAILED'));

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('returns 401 for invalid token error', () => {
    invokeErrorHandler(new Error('invalid token'));

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('returns 403 for forbidden errors', () => {
    invokeErrorHandler(new Error('forbidden'));

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'FORBIDDEN',
        }),
      }),
    );
  });

  test('returns 403 for BILLING_REQUIRED', () => {
    invokeErrorHandler(new Error('BILLING_REQUIRED'));

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 404 for not found errors', () => {
    invokeErrorHandler(new Error('Resource not found'));

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'NOT_FOUND',
          message: 'Resource not found',
        }),
      }),
    );
  });

  test('returns 404 for NOT_FOUND error code in message', () => {
    invokeErrorHandler(new Error('NOT_FOUND'));

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 429 for rate limit errors', () => {
    invokeErrorHandler(new Error('rate limit exceeded'));

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'RATE_LIMIT_EXCEEDED',
        }),
      }),
    );
  });

  test('returns 429 for RATE_LIMIT in message', () => {
    invokeErrorHandler(new Error('API_RATE_LIMIT'));

    expect(res.status).toHaveBeenCalledWith(429);
  });

  test('returns 500 for unknown errors', () => {
    invokeErrorHandler(new Error('Something completely unexpected'));

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        }),
      }),
    );
  });

  test('returns 500 for database errors', () => {
    invokeErrorHandler(new Error('Database connection failed'));

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'DATABASE_ERROR',
        }),
      }),
    );
  });

  test('returns 504 for timeout errors', () => {
    invokeErrorHandler(new Error('timeout exceeded'));

    expect(res.status).toHaveBeenCalledWith(504);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'GATEWAY_TIMEOUT',
        }),
      }),
    );
  });

  test('returns 429 for express-rate-limit error with statusCode', () => {
    const rateLimitError = new Error('Too many requests, please try again later.');
    (rateLimitError as any).statusCode = 429;

    invokeErrorHandler(rateLimitError);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'RATE_LIMIT_EXCEEDED',
        }),
      }),
    );
  });

  test('returns 500 for configuration errors', () => {
    invokeErrorHandler(new Error('Missing required environment variable: DB_URL'));

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'CONFIGURATION_ERROR',
        }),
      }),
    );
  });

  test('logs errors with request ID', () => {
    const { logger } = require('../../../src/utils/logger');

    invokeErrorHandler(new Error('test error for logging'));

    expect(logger.error).toHaveBeenCalledWith('Unhandled server error', expect.objectContaining({
      requestId: 'req-456',
    }));
  });

  test('masks sensitive data in error response', () => {
    invokeErrorHandler(new Error('Something went wrong'));

    const jsonCall = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonCall.meta).toBeDefined();
    expect(jsonCall.meta.timestamp).toBeDefined();
    expect(jsonCall.meta.requestId).toBe('req-456');
    // Should not contain passwords, tokens, etc.
    expect(jsonCall.error).not.toHaveProperty('stack');
  });

  test('includes stack trace in development mode', () => {
    // Override config for this test
    const mockConfig = require('../../../src/config/app.config');
    mockConfig.config.isDevelopment = true;

    invokeErrorHandler(new Error('dev error'));

    const jsonCall = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonCall.stack).toBeDefined();

    // Reset
    mockConfig.config.isDevelopment = false;
  });

  test('returns structured ApiResponse format', () => {
    invokeErrorHandler(new Error('test'));

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: expect.any(String),
          message: expect.any(String),
        }),
        meta: expect.objectContaining({
          timestamp: expect.any(String),
          requestId: 'req-456',
        }),
      }),
    );
  });

  test('handles unknown requestId gracefully', () => {
    const reqWithoutId = { path: '/test', method: 'GET' };
    const resMock = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    errorHandler(new Error('test'), reqWithoutId, resMock, next);

    expect(resMock.status).toHaveBeenCalledWith(500);
  });
});
