export interface AppConfig {
  port: number;
  nodeEnv: string;
  isProduction: boolean;
  isDevelopment: boolean;
  isTest: boolean;
  shopify: {
    apiKey: string;
    apiSecret: string;
    scopes: string[];
    appUrl: string;
  };
  database: {
    url: string;
  };
  redis: {
    url: string;
  };
  rabbitmq: {
    url: string;
  };
  encryption: {
    key: string;
  };
  sentry: {
    dsn: string;
  };
  logging: {
    level: string;
  };
  frontend: {
    url: string;
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    if (process.env.NODE_ENV === 'test') {
      return `${name}_NOT_SET`;
    }
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

function parseCommaSeparated(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const nodeEnv = optionalEnv('NODE_ENV', 'development');

export const config: AppConfig = {
  port: parseInt(optionalEnv('PORT', '3000'), 10),
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isDevelopment: nodeEnv === 'development',
  isTest: nodeEnv === 'test',

  shopify: {
    apiKey: requiredEnv('SHOPIFY_API_KEY'),
    apiSecret: requiredEnv('SHOPIFY_API_SECRET'),
    scopes: parseCommaSeparated(
      optionalEnv(
        'SHOPIFY_SCOPES',
        'read_products,write_products,read_customers,write_customers,read_orders,write_orders,read_inventory,write_inventory,read_price_rules',
      ),
    ),
    appUrl: optionalEnv('SHOPIFY_APP_URL', 'http://localhost:3000'),
  },

  database: {
    url: optionalEnv(
      'DATABASE_URL',
      'postgresql://postgres:postgres@localhost:5432/shopify_oracle_int',
    ),
  },

  redis: {
    url: optionalEnv('REDIS_URL', 'redis://localhost:6379'),
  },

  rabbitmq: {
    url: optionalEnv('RABBITMQ_URL', 'amqp://localhost:5672'),
  },

  encryption: {
    key: requiredEnv('ENCRYPTION_KEY'),
  },

  sentry: {
    dsn: optionalEnv('SENTRY_DSN', ''),
  },

  logging: {
    level: optionalEnv('LOG_LEVEL', nodeEnv === 'production' ? 'info' : 'debug'),
  },

  frontend: {
    url: optionalEnv('FRONTEND_URL', 'http://localhost:3001'),
  },
};
