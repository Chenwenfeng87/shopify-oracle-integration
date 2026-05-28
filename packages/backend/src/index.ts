import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import { config } from './config/app.config';
import { logger } from './utils/logger';
import { requestLogger } from './middleware/request-logger';
import { corsMiddleware } from './middleware/cors';
import { generalRateLimit } from './middleware/rate-limit';
import { errorHandler } from './middleware/error-handler';
import { closePool, testConnection as testDbConnection } from './config/database';
import { closeRedis, testConnection as testRedisConnection } from './config/redis';
import { closeConnection as closeRabbitMQ, testConnection as testRabbitMQConnection } from './config/rabbitmq';

// Route imports
import authRoutes from './routes/auth.routes';
import webhookRoutes from './routes/webhook.routes';
import syncRoutes from './routes/sync.routes';
import mappingRoutes from './routes/mapping.routes';
import credentialsRoutes from './routes/credentials.routes';
import dashboardRoutes from './routes/dashboard.routes';
import billingRoutes from './routes/billing.routes';
import gdprRoutes from './routes/gdpr.routes';

const app = express();

// ──────────────────────────────────────────────
// Global Middleware
// ──────────────────────────────────────────────

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      frameAncestors: [
        'https://*.myshopify.com',
        'https://*.shopify.com',
        config.frontend.url,
        config.isDevelopment ? 'http://*.myshopify.com' : '',
      ].filter(Boolean),
      frameSrc: [
        'https://*.myshopify.com',
        'https://*.shopify.com',
        config.isDevelopment ? 'http://*.myshopify.com' : '',
      ].filter(Boolean),
    },
  },
}));

// CORS
app.use(corsMiddleware);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Raw body capture for webhook HMAC verification
app.use(
  express.json({
    verify: (req: express.Request, _res: express.Response, buf: Buffer) => {
      // Store raw body for webhook HMAC verification
      if (req.path.startsWith('/api/webhook/')) {
        (req as any).rawBody = buf.toString();
      }
    },
  }),
);

// Session support (using PostgreSQL store in production)
if (config.isProduction) {
  const pgSession = require('connect-pg-simple')(session);
  app.use(session({
    store: new pgSession({
      conString: config.database.url,
      tableName: 'user_sessions',
    }),
    secret: config.shopify.apiSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: 'none',
    },
  }));
} else {
  app.use(session({
    secret: config.shopify.apiSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
    },
  }));
}

// Request logging (must come after session but before routes)
app.use(requestLogger);

// General rate limiting
app.use(generalRateLimit);

// ──────────────────────────────────────────────
// Health Check
// ──────────────────────────────────────────────

app.get('/health', async (_req: express.Request, res: express.Response) => {
  const start = Date.now();

  const [dbHealthy, redisHealthy, rabbitmqHealthy] = await Promise.all([
    testDbConnection(),
    testRedisConnection().catch(() => false),
    testRabbitMQConnection().catch(() => false),
  ]);

  const allHealthy = dbHealthy && redisHealthy && rabbitmqHealthy;
  const status = allHealthy ? 'healthy' : dbHealthy ? 'degraded' : 'unhealthy';

  res.status(allHealthy ? 200 : 503).json({
    success: true,
    data: {
      status,
      version: '1.0.0',
      uptime: process.uptime(),
      checks: {
        database: dbHealthy,
        redis: redisHealthy,
        rabbitmq: rabbitmqHealthy,
      },
    },
    meta: {
      timestamp: new Date().toISOString(),
      requestId: _req.requestId,
    },
  });
});

// ──────────────────────────────────────────────
// API Routes
// ──────────────────────────────────────────────

app.use('/api/auth', authRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/mappings', mappingRoutes);
app.use('/api/credentials', credentialsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/gdpr', gdprRoutes);

// ──────────────────────────────────────────────
// 404 Handler
// ──────────────────────────────────────────────

app.use((_req: express.Request, res: express.Response) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${_req.method} ${_req.path} not found`,
    },
    meta: {
      timestamp: new Date().toISOString(),
      requestId: _req.requestId,
    },
  });
});

// ──────────────────────────────────────────────
// Global Error Handler
// ──────────────────────────────────────────────

app.use(errorHandler);

// ──────────────────────────────────────────────
// Server Startup
// ──────────────────────────────────────────────

const server = app.listen(config.port, () => {
  logger.info('Backend server started', {
    port: config.port,
    environment: config.nodeEnv,
    appUrl: config.shopify.appUrl,
    apiKey: config.shopify.apiKey ? `${config.shopify.apiKey.substring(0, 8)}...` : 'not-set',
  });
});

// ──────────────────────────────────────────────
// Graceful Shutdown
// ──────────────────────────────────────────────

const shutdownSignals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

function handleShutdown(signal: NodeJS.Signals): void {
  logger.info(`Received ${signal}, starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(async (err) => {
    if (err) {
      logger.error('Error closing HTTP server', { error: err.message });
    }

    logger.info('HTTP server closed');

    // Close infrastructure connections in parallel
    const shutdownResults = await Promise.allSettled([
      closePool().catch((e: Error) => logger.error('Error closing DB pool', { error: e.message })),
      closeRedis().catch((e: Error) => logger.error('Error closing Redis', { error: e.message })),
      closeRabbitMQ().catch((e: Error) => logger.error('Error closing RabbitMQ', { error: e.message })),
    ]);

    const failed = shutdownResults.filter(
      (r) => r.status === 'rejected',
    ).length;

    if (failed > 0) {
      logger.warn(`Graceful shutdown completed with ${failed} failures`);
    } else {
      logger.info('Graceful shutdown completed successfully');
    }

    // Force exit if graceful shutdown takes too long
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000).unref();

    process.exit(0);
  });

  // If server.close doesn't complete in time, force close connections
  setTimeout(() => {
    logger.warn('Forcing server close after timeout');
    server.closeAllConnections?.();
  }, 5000).unref();
}

shutdownSignals.forEach((signal) => {
  process.on(signal, () => handleShutdown(signal));
});

// ──────────────────────────────────────────────
// Unhandled Rejection / Exception Handlers
// ──────────────────────────────────────────────

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Unhandled Promise rejection', {
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception', {
    error: error.message,
    stack: error.stack,
  });

  // Exit with failure for uncaught exceptions
  process.exit(1);
});

export default app;
