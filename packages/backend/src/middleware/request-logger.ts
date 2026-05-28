import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createChildLogger, logger } from '../utils/logger';

/**
 * Extend the Express Request interface to include a requestId property.
 * This allows downstream middleware and route handlers to access the
 * request ID for logging and correlation purposes.
 */
declare global {
  namespace Express {
    interface Request {
      requestId: string;
      storeId?: string;
      shopifyDomain?: string;
    }
  }
}

/**
 * Request logging middleware.
 *
 * 1. Assigns a unique UUID (requestId) to every incoming request.
 * 2. Creates a child logger scoped to that requestId.
 * 3. Logs the request method, URL, and query parameters on entry.
 * 4. Wraps response.end to log the status code and duration on completion.
 * 5. Attaches the child logger to req.log for use by downstream handlers.
 *
 * SKIPPED: static file requests (common Express optimization).
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Skip logging for static assets
  if (req.path.startsWith('/static/') || req.path === '/favicon.ico') {
    next();
    return;
  }

  const requestId = uuidv4();
  req.requestId = requestId;

  const childLogger = createChildLogger(requestId);
  req.log = childLogger;

  const start = Date.now();

  // Log request received
  childLogger.info('Incoming request', {
    method: req.method,
    url: req.originalUrl || req.url,
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  // Capture the original end function to calculate duration
  const originalEnd = res.end;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res.end = function (this: Response, ...args: any[]): Response {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;

    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';

    childLogger.log(level, 'Request completed', {
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode,
      duration,
      contentLength: res.getHeader('content-length'),
    });

    // Restore original end and call it
    res.end = originalEnd;
    return res.end.apply(this, args);
  };

  next();
}

/**
 * Augment the Express Request interface to include the log property.
 */
declare global {
  namespace Express {
    interface Request {
      log: typeof logger;
    }
  }
}

export default requestLogger;
