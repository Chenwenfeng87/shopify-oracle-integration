# Shopify-Oracle Fusion Cloud Integration

[![CI](https://github.com/your-org/shopify-oracle-integration/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/shopify-oracle-integration/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Shopify App Store](https://img.shields.io/badge/Shopify-App%20Store-green.svg)](https://apps.shopify.com/)
[![Node Version](https://img.shields.io/badge/node-20.x-brightgreen)](https://nodejs.org)

Seamlessly synchronize your Shopify store data with Oracle Fusion Cloud ERP. Automate the bidirectional flow of products, customers, orders, inventory, and pricing between your e-commerce and enterprise resource planning systems.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Shopify Admin                                │
│  (App Bridge iframe - where merchants configure and monitor sync)   │
└─────────────────────┬───────────────────────────────────────────────┘
                      │
                      │ HTTPS
                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│                          Nginx (Port 80/443)                        │
│                    Reverse Proxy + Rate Limiter                       │
├──────────────────────────────────────────────────────────────────────┤
│   /api/*  ────────────► ┌─────────────────────────────────────────┐  │
│                          │    Backend (Express API, Port 3000)     │  │
│   /health ────────────► │  - Shopify OAuth                        │  │
│                          │  - Oracle REST API client               │  │
│                          │  - Webhook receiver                     │  │
│                          │  - Field mapping engine                  │  │
│                          │  - Sync orchestration                    │  │
│                          │  - Billing management                    │  │
│                          └──────────┬──────────────────────────────┘  │
│                                     │                                 │
│   /* ──────────────────────────┐    │ publish                        │
│                                │    ▼                                │
│                    ┌───────────┴──────────┐   ┌────────────────────┐  │
│                    │  Frontend (React)    │   │   RabbitMQ         │  │
│                    │  Port 3001 / 80      │   │   (Message Queue)  │  │
│                    │  - Dashboard         │   └─────────┬──────────┘  │
│                    │  - Configuration UI  │             │             │
│                    │  - Field Mapper      │             │ consume     │
│                    │  - Sync Monitor      │             ▼             │
│                    │  - Log Viewer        │   ┌────────────────────┐  │
│                    └──────────────────────┘   │  Worker (Consumer) │  │
│                                               │  - Item sync       │  │
│                                               │  - Customer sync   │  │
│                                               │  - Order sync      │  │
│                                               │  - Inventory sync  │  │
│                                               │  - Price sync      │  │
│                                               └────────┬───────────┘  │
│                                                        │              │
└──────────────────────────────────────────────────────┼──────────────┘
                                                       │
                            ┌──────────────────────────┼──────────────┐
                            │         Data Layer        │              │
                            │  ┌──────────┐ ┌────────┐ │ ┌─────────┐  │
                            │  │PostgreSQL│ │ Redis  │ │ │ Oracle  │  │
                            │  │ (Primary)│ │ (Cache)│ │ │ Fusion  │  │
                            │  └──────────┘ └────────┘ │ │ Cloud   │  │
                            │                          │ │ (ERP)   │  │
                            │                          │ └─────────┘  │
                            └──────────────────────────┼──────────────┘
                                                       │
                                                       ▼
                                              ┌──────────────────┐
                                              │  Oracle Fusion   │
                                              │  Cloud ERP       │
                                              │  - Financials    │
                                              │  - Supply Chain  │
                                              │  - Manufacturing │
                                              │  - HCM           │
                                              └──────────────────┘
```

## Features

- **Bidirectional Sync** -- Synchronize products, customers, orders, inventory, and pricing between Shopify and Oracle Fusion Cloud.
- **Real-time Webhooks** -- Shopify webhooks trigger immediate sync jobs for order creation, customer updates, and inventory changes.
- **Scheduled Syncs** -- Configurable cron-based sync schedules for full or incremental data synchronization.
- **Manual Sync** -- Trigger on-demand syncs for individual entities or full data sets from the admin dashboard.
- **Field Mapping** -- Intuitive UI-based field mapper to define how Shopify fields map to Oracle Fusion Cloud fields.
- **Conflict Resolution** -- Multiple strategies (Shopify wins, Oracle wins, manual review, timestamp-based) to handle data conflicts.
- **Multi-store Support** -- Manage multiple Shopify stores and map each to different Oracle Fusion Cloud instances.
- **Comprehensive Logging** -- Detailed sync logs with error tracking, retry management, and audit trail.
- **Shopify Billing Integration** -- Usage-based and subscription billing plans managed through Shopify's billing API.
- **GDPR Compliance** -- Complete data subject request handling for Shopify's GDPR mandatory webhooks.
- **Secure Credential Storage** -- Oracle Cloud credentials encrypted at rest using AES-256.
- **Dashboard & Analytics** -- Real-time dashboard showing sync status, job history, and data volumes.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js 20 |
| **API Framework** | Express 4.x |
| **Frontend** | React 18, Shopify Polaris, React Query, Recharts |
| **Database** | PostgreSQL 15 |
| **Cache** | Redis 7 |
| **Message Broker** | RabbitMQ 3.12 |
| **Language** | TypeScript 5.x (strict mode) |
| **Containerization** | Docker, Docker Compose |
| **Bundler** | Vite 5 |
| **Testing** | Jest, Vitest, Testing Library |
| **CI/CD** | GitHub Actions |
| **Package Manager** | npm workspaces |

## Quick Start

### Prerequisites

- Node.js 20+
- Docker and Docker Compose
- A Shopify Partner account (for API credentials)
- An Oracle Fusion Cloud instance with API access

### One-command start

```bash
# Clone the repository
git clone https://github.com/your-org/shopify-oracle-integration.git
cd shopify-oracle-integration

# Copy environment file and edit with your credentials
cp .env.example .env

# Start all services
docker-compose up -d
```

The application will be available at:
- **Frontend (React SPA):** http://localhost:3001
- **Backend API:** http://localhost:3000
- **Health Check:** http://localhost:3000/health
- **RabbitMQ Management:** http://localhost:15672 (guest/guest)
- **Nginx Reverse Proxy:** http://localhost:80

### Development without Docker

```bash
# Install dependencies
npm ci

# Start infrastructure (PostgreSQL, Redis, RabbitMQ)
docker-compose up -d postgres redis rabbitmq

# Run database migrations
npm run db:migrate

# Start development servers (backend, worker, frontend concurrently)
npm run dev
```

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `SHOPIFY_API_KEY` | Shopify App API key | Yes | -- |
| `SHOPIFY_API_SECRET` | Shopify App API secret | Yes | -- |
| `SHOPIFY_SCOPES` | OAuth scopes (comma-separated) | Yes | (see .env.example) |
| `SHOPIFY_APP_URL` | Public URL of your app (for OAuth redirect) | Yes | -- |
| `DATABASE_URL` | PostgreSQL connection string | Yes | `postgresql://postgres:postgres@postgres:5432/shopify_oracle_int` |
| `REDIS_URL` | Redis connection string | Yes | `redis://redis:6379` |
| `RABBITMQ_URL` | RabbitMQ connection string | Yes | `amqp://rabbitmq:5672` |
| `ENCRYPTION_KEY` | 32-byte AES-256 encryption key for credentials | Yes | -- |
| `SENTRY_DSN` | Sentry error tracking DSN | No | -- |
| `NODE_ENV` | Environment (development/production/test) | No | development |
| `PORT` | Backend server port | No | 3000 |
| `LOG_LEVEL` | Logging verbosity | No | debug |
| `FRONTEND_URL` | Frontend URL for CORS | No | http://localhost:3001 |

## Project Structure

```
shopify-oracle-integration/
├── .github/workflows/
│   ├── ci.yml                          # Continuous integration pipeline
│   └── deploy.yml                      # Deployment pipeline
├── database/
│   └── migrations/
│       ├── 001_initial_schema.sql      # Core tables
│       └── 002_seed_default_mappings.sql
├── docs/
│   ├── README.md                       # You are here
│   ├── INSTALLATION.md                 # Step-by-step installation guide
│   ├── CONFIGURATION.md                # Configuration reference
│   └── USER_MANUAL.md                  # End-user documentation
├── packages/
│   ├── shared/                         # Shared code (types, constants, utils)
│   │   └── src/
│   │       ├── constants/              # Entity types, sync statuses, error codes
│   │       ├── types/                  # TypeScript type definitions
│   │       └── utils/                  # Field mapper, validation, retry logic
│   ├── backend/                        # Express API server
│   │   └── src/
│   │       ├── config/                 # App, database, redis, rabbitmq config
│   │       ├── controllers/            # Route handler logic
│   │       ├── middleware/             # Auth, CORS, rate limiting, error handling
│   │       ├── models/                 # Database models (billing, credentials, etc.)
│   │       ├── routes/                 # Express route definitions
│   │       ├── services/               # Oracle client, Shopify client, sync engine
│   │       └── utils/                  # Encryption, logger, GDPR helpers
│   ├── worker/                         # Background job processor
│   │   └── src/
│   │       ├── consumers/              # RabbitMQ consumers per entity type
│   │       ├── handlers/              # Sync handlers for each entity
│   │       └── types/                  # Worker-specific types
│   └── frontend/                       # React SPA (Shopify Polaris)
│       └── src/
│           ├── components/             # Reusable UI components
│           ├── hooks/                  # Custom React hooks
│           ├── pages/                  # Page components
│           └── utils/                  # Frontend utilities
├── Dockerfile.backend                  # Backend Dockerfile (multi-stage)
├── Dockerfile.worker                   # Worker Dockerfile (multi-stage)
├── Dockerfile.frontend                 # Frontend Dockerfile (multi-stage)
├── docker-compose.yml                  # Development compose file
├── docker-compose.prod.yml             # Production compose overrides
├── nginx.conf                          # Nginx reverse proxy configuration
├── tsconfig.base.json                  # Shared TypeScript configuration
├── package.json                        # Root workspace package.json
├── .env.example                        # Environment variable template
├── .eslintrc.json                      # ESLint configuration
├── .prettierrc                         # Prettier configuration
└── jest.config.js                      # Jest configuration
```

## Documentation

- **[Installation Guide](INSTALLATION.md)** -- Detailed setup instructions for all environments
- **[Configuration Guide](CONFIGURATION.md)** -- Complete configuration reference for Shopify, Oracle, field mapping, and sync schedules
- **[User Manual](USER_MANUAL.md)** -- End-user guide covering dashboard, sync management, and troubleshooting

## Development

```bash
# Run linter
npm run lint

# Run type checker
npm run build

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Build all packages
npm run build

# Run database migrations
npm run db:migrate
```

## Deployment

See the [Installation Guide](INSTALLATION.md) for production deployment instructions.

### Quick production start

```bash
# Build and start production containers
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Run migrations
docker-compose -f docker-compose.yml -f docker-compose.prod.yml run --rm backend npm run db:migrate
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License -- see the [LICENSE](LICENSE) file for details.

## Support

For support, feature requests, or bug reports, please open an issue on the [GitHub repository](https://github.com/your-org/shopify-oracle-integration/issues).

---

Built for merchants who need enterprise-grade ERP integration for their Shopify stores.
