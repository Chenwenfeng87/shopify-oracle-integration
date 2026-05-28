import winston from 'winston';
import { config } from '../config/app.config';

/**
 * Format log output for console with colorization and human-readable layout.
 */
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, requestId, ...meta }) => {
    const requestTag = requestId ? ` [${requestId}]` : '';
    const metaStr =
      Object.keys(meta).length > 0
        ? ` ${JSON.stringify(meta, null, 0)}`
        : '';
    return `${timestamp} ${level}${requestTag}: ${message}${metaStr}`;
  }),
);

/**
 * Format log output for file transport as structured JSON.
 */
const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

/**
 * Create the base logger instance.
 */
const logger = winston.createLogger({
  level: config.logging.level,
  defaultMeta: {
    service: 'shopify-oracle-backend',
    environment: config.nodeEnv,
  },
  transports: [],
});

/**
 * Add console transport for all environments.
 */
logger.add(
  new winston.transports.Console({
    format: consoleFormat,
    level: config.isProduction ? 'info' : 'debug',
  }),
);

/**
 * Add file transport for production environment.
 * Logs errors to a separate file for easy debugging.
 */
if (config.isProduction) {
  logger.add(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: jsonFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 10,
    }),
  );

  logger.add(
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: jsonFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
  );
}

/**
 * Create a child logger with a request ID pre-populated in every log entry.
 * This makes it possible to correlate all log entries for a single request.
 */
export function createChildLogger(requestId: string): winston.Logger {
  return logger.child({ requestId });
}

/**
 * Add Sentry transport for error-level logging when DSN is configured.
 * Uses the Sentry SDK if available; silently skips if not installed.
 */
if (config.sentry.dsn) {
  try {
    // Dynamic import to avoid hard dependency on @sentry/node
    const Sentry = require('@sentry/node');
    Sentry.init({ dsn: config.sentry.dsn, environment: config.nodeEnv });

    logger.add(
      new winston.transports.Console({
        level: 'error',
        format: winston.format.combine(
          winston.format((info) => {
            if (info.level === 'error') {
              Sentry.captureException(info.error || info.message, {
                tags: { service: 'shopify-oracle-backend' },
                extra: info,
              });
            }
            return info;
          })(),
          winston.format.json(),
        ),
      }),
    );

    logger.info('Sentry transport initialized');
  } catch {
    logger.warn('Sentry SDK not available, Sentry transport skipped');
  }
}

export { logger };
export default logger;
