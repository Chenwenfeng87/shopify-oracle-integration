import Redis from 'ioredis';
import { config } from './app.config';
import { logger } from '../utils/logger';

let client: Redis | null = null;
let isConnected = false;

/**
 * Create and return a Redis client instance.
 * If a client already exists, return the existing instance.
 */
export function getRedisClient(): Redis {
  if (client) {
    return client;
  }

  client = new Redis(config.redis.url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times: number): number | null {
      if (times > 5) {
        logger.error('Redis connection max retries exceeded');
        return null;
      }
      const delay = Math.min(times * 200, 2000);
      logger.warn(`Redis connection retry ${times} in ${delay}ms`);
      return delay;
    },
    enableReadyCheck: true,
    lazyConnect: false,
    keepAlive: 30000,
    connectTimeout: 10000,
  });

  client.on('connect', () => {
    logger.info('Redis client connecting...');
  });

  client.on('ready', () => {
    isConnected = true;
    logger.info('Redis client connected and ready');
  });

  client.on('error', (err: Error) => {
    logger.error('Redis client error', {
      error: err.message,
    });
  });

  client.on('close', () => {
    isConnected = false;
    logger.warn('Redis connection closed');
  });

  client.on('reconnecting', (delay: number) => {
    logger.info(`Redis reconnecting in ${delay}ms`);
  });

  client.on('end', () => {
    isConnected = false;
    logger.info('Redis connection ended');
  });

  return client;
}

/**
 * Get the current Redis client (without creating one if it doesn't exist).
 * Returns null if no client has been created yet.
 */
export function getClientIfExists(): Redis | null {
  return client;
}

/**
 * Check whether the Redis client is currently connected.
 */
export function isRedisConnected(): boolean {
  return isConnected;
}

/**
 * Test Redis connectivity by running PING.
 */
export async function testConnection(): Promise<boolean> {
  try {
    const redis = getRedisClient();
    const result = await redis.ping();
    return result === 'PONG';
  } catch (error) {
    logger.error('Redis connection test failed', {
      error: (error as Error).message,
    });
    return false;
  }
}

/**
 * Close the Redis connection gracefully.
 */
export async function closeRedis(): Promise<void> {
  if (client) {
    logger.info('Closing Redis connection');
    await client.quit();
    client = null;
    isConnected = false;
  }
}

export { client as redisClient };
export default getRedisClient;
