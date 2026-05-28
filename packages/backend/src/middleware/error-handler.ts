import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';
import { config } from '../config/app.config';

/**
 * Known error types that the application can produce.
 * Each maps to a specific HTTP status code and error code string.
 */
interface KnownError {
  statusCode: number;
  errorCode: string;
  message: string;
  details?: unknown;
}

/**
 * Determine if an error is a known application error and map it
 * to a structured response. Unknown errors get a generic 500 response.
 */
function classifyError(error: Error): KnownError {
  // Zod validation errors
  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      errorCode: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: error.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
        code: e.code,
      })),
    };
  }

  // Check for specific error messages
  const message = error.message;

  if (message.includes('Missing required environment variable')) {
    return {
      statusCode: 500,
      errorCode: 'CONFIGURATION_ERROR',
      message: 'Server configuration error',
      details: config.isDevelopment ? message : undefined,
    };
  }

  if (message.includes('rate limit') || message.includes('RATE_LIMIT')) {
    return {
      statusCode: 429,
      errorCode: 'RATE_LIMIT_EXCEEDED',
      message: 'Rate limit exceeded',
    };
  }

  if (message.includes('not found') || message.includes('NOT_FOUND')) {
    return {
      statusCode: 404,
      errorCode: 'NOT_FOUND',
      message: 'Resource not found',
    };
  }

  if (
    message.includes('unauthorized') ||
    message.includes('UNAUTHORIZED') ||
    message.includes('invalid token') ||
    message.includes('AUTH_FAILED')
  ) {
    return {
      statusCode: 401,
      errorCode: 'UNAUTHORIZED',
      message: 'Authentication required',
    };
  }

  if (
    message.includes('forbidden') ||
    message.includes('FORBIDDEN') ||
    message.includes('BILLING_REQUIRED')
  ) {
    return {
      statusCode: 403,
      errorCode: 'FORBIDDEN',
      message: 'Access denied',
    };
  }

  if (message.includes('Database') || message.includes('database')) {
    return {
      statusCode: 500,
      errorCode: 'DATABASE_ERROR',
      message: 'A database error occurred',
    };
  }

  if (message.includes('timeout') || message.includes('TIMEOUT')) {
    return {
      statusCode: 504,
      errorCode: 'GATEWAY_TIMEOUT',
      message: 'Upstream service timed out',
    };
  }

  // Rate limit error from express-rate-limit
  if ('statusCode' in error && (error as any).statusCode === 429) {
    return {
      statusCode: 429,
      errorCode: 'RATE_LIMIT_EXCEEDED',
      message: error.message || 'Too many requests',
    };
  }

  // Default unknown error
  return {
    statusCode: 500,
    errorCode: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
  };
}

/**
 * Global Express error handler middleware.
 *
 * Must be registered AFTER all routes.
 * Express distinguishes error handlers by the 4-parameter signature.
 *
 * - Catches all errors thrown or passed via next(error)
 * - Logs with request ID for correlation
 * - Classifies known vs unknown errors
 * - Returns structured ApiResponse format
 * - Sends error details to Sentry in production (via logger)
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = req.requestId || 'unknown';
  const classified = classifyError(err);

  // Log the error at appropriate level
  if (classified.statusCode >= 500) {
    logger.error('Unhandled server error', {
      requestId,
      error: err.message,
      stack: config.isDevelopment ? err.stack : undefined,
      path: req.path,
      method: req.method,
    });
  } else {
    logger.warn('Handled application error', {
      requestId,
      error: err.message,
      errorCode: classified.errorCode,
      path: req.path,
      method: req.method,
    });
  }

  // Build the structured ApiResponse error payload
  const errorPayload: Record<string, unknown> = {
    success: false,
    error: {
      code: classified.errorCode,
      message: classified.message,
    },
    meta: {
      timestamp: new Date().toISOString(),
      requestId,
    },
  };

  // Include validation details if present
  if (classified.details) {
    (errorPayload.error as Record<string, unknown>).details = classified.details;
  }

  // Include stack trace in development for debugging
  if (config.isDevelopment && classified.statusCode >= 500) {
    (errorPayload as Record<string, unknown>).stack = err.stack;
  }

  res.status(classified.statusCode).json(errorPayload);
}

export default errorHandler;
