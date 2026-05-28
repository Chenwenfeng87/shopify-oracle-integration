import { connect, Channel, Connection } from 'amqplib';
import Redis from 'ioredis';
import { initDatabase, closeDatabase } from './database';
import { logger } from './logger';
import { createItemSyncConsumer } from './consumers/item-sync.consumer';
import { createCustomerSyncConsumer } from './consumers/customer-sync.consumer';
import { createPriceSyncConsumer } from './consumers/price-sync.consumer';
import { createOrderSyncConsumer } from './consumers/order-sync.consumer';
import { createInventorySyncConsumer } from './consumers/inventory-sync.consumer';

// ============================================================================
// Worker Configuration
// ============================================================================

interface AppState {
  rabbitmqConnection: Connection | null;
  rabbitmqChannel: Channel | null;
  redis: Redis | null;
  isShuttingDown: boolean;
}

const state: AppState = {
  rabbitmqConnection: null,
  rabbitmqChannel: null,
  redis: null,
  isShuttingDown: false,
};

const QUEUES = [
  'sync.items.queue',
  'sync.customers.queue',
  'sync.orders.queue',
  'sync.prices.queue',
  'sync.inventory.queue',
] as const;

const EXCHANGE = 'sync.exchange';
const DLX = 'sync.dlx';
const DLQ = 'sync.dlq';

// ============================================================================
// RabbitMQ Setup
// ============================================================================

async function setupRabbitMQ(): Promise<{ connection: Connection; channel: Channel }> {
  const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
  logger.info('Connecting to RabbitMQ', { url: rabbitmqUrl.replace(/\/\/.*@/, '//***@') });

  const connection = await connect(rabbitmqUrl);
  logger.info('Connected to RabbitMQ');

  connection.on('error', (err) => {
    logger.error('RabbitMQ connection error', { error: err.message });
  });

  connection.on('close', () => {
    logger.warn('RabbitMQ connection closed');
    if (!state.isShuttingDown) {
      logger.info('Attempting RabbitMQ reconnection in 5 seconds...');
      setTimeout(async () => {
        try {
          const { connection: newConn, channel: newChan } = await setupRabbitMQ();
          state.rabbitmqConnection = newConn;
          state.rabbitmqChannel = newChan;
          await setupConsumers(newChan);
        } catch (err) {
          logger.error('RabbitMQ reconnection failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }, 5000);
    }
  });

  const channel = await connection.createChannel();

  // Set prefetch count for fair dispatch
  const prefetchCount = parseInt(process.env.RABBITMQ_PREFETCH || '10', 10);
  await channel.prefetch(prefetchCount);

  // Assert exchanges and queues
  await channel.assertExchange(EXCHANGE, 'direct', { durable: true });
  await channel.assertExchange(DLX, 'direct', { durable: true });

  // Dead letter queue
  await channel.assertQueue(DLQ, {
    durable: true,
    arguments: {
      'x-queue-type': 'classic',
    },
  });
  await channel.bindQueue(DLQ, DLX, 'dlq');

  // Main queues with dead-letter configuration
  for (const queueName of QUEUES) {
    await channel.assertQueue(queueName, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': DLX,
        'x-dead-letter-routing-key': 'dlq',
        'x-queue-type': 'classic',
      },
    });
    await channel.bindQueue(queueName, EXCHANGE, queueName);
  }

  logger.info('RabbitMQ exchanges and queues configured', {
    exchange: EXCHANGE,
    dlx: DLX,
    queues: QUEUES,
    prefetchCount,
  });

  return { connection, channel };
}

// ============================================================================
// Redis Setup
// ============================================================================

function setupRedis(): Redis {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  logger.info('Connecting to Redis', { url: redisUrl.replace(/\/\/.*@/, '//***@') });

  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 5) {
        logger.error('Redis max retries exceeded');
        return null;
      }
      const delay = Math.min(times * 200, 2000);
      return delay;
    },
    lazyConnect: true,
    enableReadyCheck: true,
  });

  redis.on('connect', () => {
    logger.info('Redis connected');
  });

  redis.on('error', (err) => {
    logger.error('Redis error', { error: err.message });
  });

  redis.on('close', () => {
    logger.warn('Redis connection closed');
  });

  return redis;
}

// ============================================================================
// Consumer Setup
// ============================================================================

async function setupConsumers(channel: Channel): Promise<void> {
  const consumers = [
    { queue: 'sync.items.queue', handler: createItemSyncConsumer },
    { queue: 'sync.customers.queue', handler: createCustomerSyncConsumer },
    { queue: 'sync.prices.queue', handler: createPriceSyncConsumer },
    { queue: 'sync.orders.queue', handler: createOrderSyncConsumer },
    { queue: 'sync.inventory.queue', handler: createInventorySyncConsumer },
  ];

  for (const { queue, handler } of consumers) {
    const consumer = handler(channel, state.redis!);
    await channel.consume(queue, consumer, { noAck: false });
    logger.info('Consumer registered', { queue });
  }

  logger.info('All entity consumers registered successfully');
}

// ============================================================================
// Health Check & Status Logging
// ============================================================================

async function logHealthStatus(): Promise<void> {
  try {
    const channel = state.rabbitmqChannel;
    if (!channel) {
      logger.warn('Health check: RabbitMQ channel not available');
      return;
    }

    const queueInfo = await Promise.all(
      QUEUES.map(async (name) => {
        const info = await channel.checkQueue(name);
        return { queue: name, messageCount: info.messageCount, consumerCount: info.consumerCount };
      })
    );

    const dlqInfo = await channel.checkQueue(DLQ);

    logger.info('Worker health status', {
      queues: queueInfo,
      deadLetterQueue: {
        queue: DLQ,
        messageCount: dlqInfo.messageCount,
        consumerCount: dlqInfo.consumerCount,
      },
      redisConnected: state.redis?.status === 'ready',
    });
  } catch (err) {
    logger.error('Health check failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

async function shutdown(signal: string): Promise<void> {
  if (state.isShuttingDown) {
    logger.warn('Shutdown already in progress, ignoring duplicate signal');
    return;
  }

  state.isShuttingDown = true;
  logger.info(`Received ${signal}, starting graceful shutdown...`);

  // Give in-flight processing time to complete
  const shutdownTimeout = setTimeout(() => {
    logger.error('Shutdown timeout exceeded, forcing exit');
    process.exit(1);
  }, 30000);

  try {
    // Close RabbitMQ channel and connection
    if (state.rabbitmqChannel) {
      await state.rabbitmqChannel.close();
      logger.info('RabbitMQ channel closed');
    }
    if (state.rabbitmqConnection) {
      await state.rabbitmqConnection.close();
      logger.info('RabbitMQ connection closed');
    }

    // Close Redis
    if (state.redis) {
      await state.redis.quit();
      logger.info('Redis connection closed');
    }

    // Close database pool
    await closeDatabase();

    clearTimeout(shutdownTimeout);
    logger.info('Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown', {
      error: err instanceof Error ? err.message : String(err),
    });
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  logger.info('Starting Shopify-Oracle Integration Worker', {
    nodeVersion: process.version,
    platform: process.platform,
    pid: process.pid,
  });

  try {
    // Initialize database
    initDatabase();
    logger.info('Database pool initialized');

    // Setup Redis
    state.redis = setupRedis();
    await state.redis.connect();

    // Setup RabbitMQ
    const { connection, channel } = await setupRabbitMQ();
    state.rabbitmqConnection = connection;
    state.rabbitmqChannel = channel;

    // Register consumers
    await setupConsumers(channel);

    // Log initial health
    await logHealthStatus();

    // Periodic health logging
    const heartbeatIntervalMs = parseInt(
      process.env.HEARTBEAT_INTERVAL_MS || '60000',
      10
    );
    setInterval(logHealthStatus, heartbeatIntervalMs);

    // Register shutdown handlers
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGHUP', () => shutdown('SIGHUP'));

    // Handle uncaught errors
    process.on('uncaughtException', (err) => {
      logger.error('Uncaught exception', { error: err.message, stack: err.stack });
      shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection', {
        error: reason instanceof Error ? reason.message : String(reason),
      });
    });

    logger.info('Worker initialization complete, entering event loop');
  } catch (err) {
    logger.error('Failed to initialize worker', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    process.exit(1);
  }
}

// Run
main();
