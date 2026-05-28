# Installation Guide

This guide walks you through installing and configuring the Shopify-Oracle Fusion Cloud Integration app, from prerequisites to production deployment.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Step 1: Clone the Repository](#step-1-clone-the-repository)
3. [Step 2: Configure Environment Variables](#step-2-configure-environment-variables)
4. [Step 3: Shopify App Setup](#step-3-shopify-app-setup)
5. [Step 4: Oracle Cloud Setup](#step-4-oracle-cloud-setup)
6. [Step 5: Docker Deployment](#step-5-docker-deployment)
7. [Step 6: Verify Installation](#step-6-verify-installation)
8. [Step 7: Register Webhooks](#step-7-register-webhooks)
9. [Production Deployment](#production-deployment)
10. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before you begin, ensure you have the following installed and configured:

### Required Software

| Software | Version | Purpose |
|----------|---------|---------|
| **Node.js** | 20.x or later | Runtime for the application |
| **Docker** | 24.x or later | Containerized deployment |
| **Docker Compose** | 2.x or later | Multi-container orchestration |
| **PostgreSQL** | 15.x | Primary database (handled by Docker) |
| **Redis** | 7.x | Caching and job coordination (handled by Docker) |
| **RabbitMQ** | 3.12.x | Message broker (handled by Docker) |
| **Git** | 2.x | Version control |

### Required Accounts

- **Shopify Partner Account** -- Required to create and manage a Shopify app. Sign up at [partners.shopify.com](https://partners.shopify.com).
- **Shopify Store** -- A development or production store to install the app on.
- **Oracle Fusion Cloud Instance** -- Access to Oracle Fusion Cloud ERP with REST API capabilities.

### System Requirements

- **CPU:** 2+ cores (4+ recommended for production)
- **RAM:** 4 GB minimum (8 GB+ recommended for production)
- **Disk:** 10 GB free space minimum
- **OS:** Linux (Ubuntu 22.04+, Debian 12+, RHEL 9+), macOS 13+, or Windows 11 with WSL2

---

## Step 1: Clone the Repository

```bash
git clone https://github.com/your-org/shopify-oracle-integration.git
cd shopify-oracle-integration
```

### Verify the repository structure

```bash
ls -la
# You should see:
# Dockerfile.backend
# Dockerfile.worker
# Dockerfile.frontend
# docker-compose.yml
# docker-compose.prod.yml
# nginx.conf
# package.json
# tsconfig.base.json
# .env.example
# packages/
# docs/
# database/
```

---

## Step 2: Configure Environment Variables

### Create the .env file

```bash
cp .env.example .env
```

### Edit the .env file with your values

```bash
nano .env
```

### Essential variables to configure

```ini
# Shopify App Credentials (get these from Step 3)
SHOPIFY_API_KEY=your_shopify_api_key_here
SHOPIFY_API_SECRET=your_shopify_api_secret_here
SHOPIFY_SCOPES=read_products,write_products,read_customers,write_customers,read_orders,write_orders,read_inventory,write_inventory,read_price_rules,write_price_rules
SHOPIFY_APP_URL=https://your-app.ngrok.io

# Database Connection
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/shopify_oracle_int

# Redis Connection
REDIS_URL=redis://redis:6379

# RabbitMQ Connection
RABBITMQ_URL=amqp://rabbitmq:5672

# Encryption Key (generate a secure random 32-byte key)
ENCRYPTION_KEY=generate_a_secure_32_byte_key_here!!!!!!

# App Settings
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug
FRONTEND_URL=http://localhost:3001
```

### Generate a secure encryption key

```bash
# On Linux/macOS
openssl rand -hex 32

# Or using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Step 3: Shopify App Setup

### 3.1 Create a Shopify App

1. Log in to [Shopify Partners](https://partners.shopify.com).
2. Navigate to **Apps** > **Create App**.
3. Choose **Public app** (for App Store) or **Custom app** (for single store).
4. Enter the app name: "Shopify-Oracle Integration".
5. Click **Create App**.

### 3.2 Configure App URLs

Under **Configuration** > **App URLs**:

```
App URL: https://your-app.ngrok.io
Allowed redirection URL(s):
  https://your-app.ngrok.io/api/auth/shopify/callback
  https://your-app.ngrok.io/api/auth/shopify/install
```

> **Note:** For local development, use [ngrok](https://ngrok.com) to expose your local server: `ngrok http 3000`. Use the ngrok HTTPS URL as your `SHOPIFY_APP_URL`.

### 3.3 Configure OAuth Scopes

Under **Configuration** > **Scopes**:

Select the following scopes:
- `read_products`, `write_products`
- `read_customers`, `write_customers`
- `read_orders`, `write_orders`
- `read_inventory`, `write_inventory`
- `read_price_rules`, `write_price_rules`

### 3.4 Configure Webhooks

Under **Configuration** > **Webhooks**:

Add the following webhook endpoints (all pointing to your app URL):

| Event | Endpoint |
|-------|----------|
| Products create | `https://your-app.ngrok.io/api/webhook/products/create` |
| Products update | `https://your-app.ngrok.io/api/webhook/products/update` |
| Products delete | `https://your-app.ngrok.io/api/webhook/products/delete` |
| Customers create | `https://your-app.ngrok.io/api/webhook/customers/create` |
| Customers update | `https://your-app.ngrok.io/api/webhook/customers/update` |
| Customers delete | `https://your-app.ngrok.io/api/webhook/customers/delete` |
| Orders create | `https://your-app.ngrok.io/api/webhook/orders/create` |
| Orders update | `https://your-app.ngrok.io/api/webhook/orders/update` |
| Orders cancelled | `https://your-app.ngrok.io/api/webhook/orders/cancelled` |
| Inventory levels update | `https://your-app.ngrok.io/api/webhook/inventory/update` |
| Price rules create | `https://your-app.ngrok.io/api/webhook/pricing/create` |
| Price rules update | `https://your-app.ngrok.io/api/webhook/pricing/update` |
| GDPR data request | `https://your-app.ngrok.io/api/webhook/gdpr/data_request` |
| GDPR redaction | `https://your-app.ngrok.io/api/webhook/gdpr/redaction` |

### 3.5 Set API Version

Under **Configuration** > **API Version**:

Select **2024-07** (or the latest stable version).

### 3.6 Get API Credentials

Go to the **API Credentials** tab and copy:
- **API Key** -- Set as `SHOPIFY_API_KEY` in your `.env` file
- **API Secret** -- Set as `SHOPIFY_API_SECRET` in your `.env` file

---

## Step 4: Oracle Cloud Setup

### 4.1 Create an API User

1. Log in to your Oracle Fusion Cloud instance as an administrator.
2. Navigate to **Security Console** > **Users**.
3. Create a new API user with a service account role.
4. Note the username and generate a secure password.

### 4.2 Configure API Roles

Assign the following roles to the API user:
- `REST Service - Financial Management` (or equivalent)
- `REST Service - Supply Chain Management`
- `REST Service - Inventory Management`
- `REST Service - Customer Data Management`
- `REST Service - Product Management`

### 4.3 Enable REST Services

1. Navigate to **Setup and Maintenance** > **REST Services**.
2. Enable the following services:
   - **Items REST Service** (`/fscmRestApi/resources/11.13.18.05/items`)
   - **Customers REST Service** (`/crmRestApi/resources/11.13.18.05/customers`)
   - **Orders REST Service** (`/orderManagementRestApi/resources/11.13.18.05/orders`)
   - **Inventory REST Service** (`/inventoryManagementRestApi/resources/11.13.18.05/inventory`)
   - **Prices REST Service** (`/pricingRestApi/resources/11.13.18.05/prices`)

### 4.4 Get Oracle Cloud Credentials

You will need the following information:
- **Oracle Cloud Host** -- The base URL of your Oracle Cloud instance (e.g., `https://your-instance.fa.us2.oraclecloud.com`)
- **Oracle Cloud User** -- The API service account username
- **Oracle Cloud Password** -- The API service account password
- **Oracle Cloud Tenant** -- Your Oracle Cloud tenant name

---

## Step 5: Docker Deployment

### 5.1 Development Deployment

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Check service status
docker-compose ps
```

### 5.2 Run Database Migrations

```bash
docker-compose exec backend npm run db:migrate
```

### 5.3 Verify All Services are Running

```bash
docker-compose ps

# Expected output:
# Name                          Status              Ports
# shopify-oracle-postgres       Up (healthy)        5432/tcp
# shopify-oracle-redis          Up (healthy)        6379/tcp
# shopify-oracle-rabbitmq       Up (healthy)        5672/tcp, 15672/tcp
# shopify-oracle-backend        Up                  3000/tcp
# shopify-oracle-worker         Up
# shopify-oracle-frontend       Up                  3001/tcp
# shopify-oracle-nginx          Up                  80/tcp
```

### 5.4 Production Deployment

#### Prepare the server

```bash
# SSH into your production server
ssh user@your-production-server

# Install Docker and Docker Compose
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Create application directory
sudo mkdir -p /opt/shopify-oracle
sudo chown $USER:$USER /opt/shopify-oracle
```

#### Deploy

```bash
# On your production server
cd /opt/shopify-oracle

# Clone the repository
git clone https://github.com/your-org/shopify-oracle-integration.git .

# Create .env file with production values
cp .env.example .env
nano .env

# Pull and start production services
docker-compose -f docker-compose.yml -f docker-compose.prod.yml pull
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Run migrations
docker-compose -f docker-compose.yml -f docker-compose.prod.yml run --rm backend npm run db:migrate
```

#### Set up HTTPS with Let's Encrypt

```bash
# Install certbot
sudo apt install certbot -y

# Get SSL certificate
sudo certbot certonly --standalone -d your-domain.com

# Create SSL directory and copy certificates
sudo mkdir -p /opt/shopify-oracle/ssl
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem /opt/shopify-oracle/ssl/
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem /opt/shopify-oracle/ssl/

# Restart nginx
docker-compose -f docker-compose.yml -f docker-compose.prod.yml restart nginx
```

---

## Step 6: Verify Installation

### Check the health endpoint

```bash
curl http://localhost:80/health
```

Expected response:

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "version": "1.0.0",
    "uptime": 123.45,
    "checks": {
      "database": true,
      "redis": true,
      "rabbitmq": true
    }
  },
  "meta": {
    "timestamp": "2024-01-15T10:30:00.000Z",
    "requestId": "req-abc123"
  }
}
```

### Check RabbitMQ Management Console

Open http://localhost:15672 in your browser and log in with:
- **Username:** guest
- **Password:** guest

You should see:
- Exchange `sync.exchange` and `sync.dlx` defined
- All 5 sync queues listed
- The worker consumers connected to the queues

### Test the Frontend

Open http://localhost:3001 (or https://your-domain.com in production) in your browser.
You should see the Shopify-Oracle Integration dashboard.

---

## Step 7: Register Webhooks

### Automatic Registration

When you install the app on a Shopify store, webhooks are registered automatically during the OAuth flow. The installation process:

1. Merchant clicks "Install" on the Shopify App Store or install link.
2. App's OAuth flow triggers, requesting the configured scopes.
3. After authorization, the app automatically registers all required webhooks via Shopify's REST API.
4. The app creates the store record in the database with the webhook IDs.

### Manual Webhook Registration

If you need to re-register webhooks or register them for an existing store:

```bash
# Using the API
curl -X POST http://localhost:3000/api/webhook/register \
  -H "Content-Type: application/json" \
  -d '{"storeId": "store-uuid-here"}'
```

### Verify Webhook Registration

```bash
# List all webhooks for a store (requires admin API token)
curl -X GET "https://your-store.myshopify.com/admin/api/2024-07/webhooks.json" \
  -H "X-Shopify-Access-Token: your-access-token"
```

---

## Production Deployment

### Using GitHub Actions (Recommended)

1. Fork or push the repository to GitHub.
2. Configure the following GitHub Action secrets:

| Secret Name | Description |
|-------------|-------------|
| `SSH_DEPLOY_HOST` | Production server hostname/IP |
| `SSH_DEPLOY_USER` | SSH username |
| `SSH_DEPLOY_KEY` | SSH private key |
| `SSH_KNOWN_HOSTS` | Server SSH host key |
| `DATABASE_URL` | Production database URL |
| `REDIS_URL` | Production Redis URL |
| `RABBITMQ_URL` | Production RabbitMQ URL |
| `SHOPIFY_API_KEY` | Shopify app API key |
| `SHOPIFY_API_SECRET` | Shopify app API secret |
| `SHOPIFY_APP_URL` | Production app URL |
| `ENCRYPTION_KEY` | 32-byte encryption key |
| `SLACK_WEBHOOK_URL` | (Optional) Slack notification webhook |

3. Create a GitHub Release -- the deploy workflow will trigger automatically.

### Manual Production Deployment

```bash
# On your production server
export DATABASE_URL="postgresql://user:pass@host:5432/shopify_oracle_int"
export REDIS_URL="redis://redis:6379"
export RABBITMQ_URL="amqp://rabbitmq:5672"
export SHOPIFY_API_KEY="your-key"
export SHOPIFY_API_SECRET="your-secret"
export SHOPIFY_APP_URL="https://your-domain.com"
export ENCRYPTION_KEY="your-32-byte-key"

docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
docker-compose -f docker-compose.yml -f docker-compose.prod.yml run --rm backend npm run db:migrate
```

---

## Troubleshooting

### Issue 1: Database connection refused

**Symptoms:**
- Backend fails to start with `ECONNREFUSED` error.
- Health check returns `database: false`.

**Solutions:**
1. Verify PostgreSQL is running:
   ```bash
   docker-compose ps postgres
   ```
2. Check PostgreSQL logs:
   ```bash
   docker-compose logs postgres
   ```
3. Verify the `DATABASE_URL` in `.env` matches the PostgreSQL service name and credentials.
4. Ensure PostgreSQL health check has completed (may take 30 seconds on first start).

### Issue 2: Shopify OAuth fails with "redirect_uri_mismatch"

**Symptoms:**
- After clicking "Install," the browser redirects to an error page showing `redirect_uri_mismatch`.

**Solutions:**
1. Verify `SHOPIFY_APP_URL` in `.env` exactly matches the **App URL** in your Shopify Partner dashboard.
2. Ensure the **Allowed redirection URL(s)** in Shopify Partner settings includes `https://your-domain.com/api/auth/shopify/callback`.
3. The URL must use HTTPS in production. For development, use ngrok to get an HTTPS URL.
4. Check that there are no trailing slashes in the URLs.

### Issue 3: Webhook delivery failures

**Symptoms:**
- Webhooks are registered but Shopify reports delivery failures.
- The sync logs show no entries for webhook-triggered events.

**Solutions:**
1. Verify the webhook endpoint URLs are publicly accessible:
   ```bash
   curl -v https://your-domain.com/api/webhook/products/create
   ```
   (Expect a 401 Unauthorized -- that is fine, it means the endpoint is reachable.)
2. Check the webhook HMAC verification -- ensure `SHOPIFY_API_SECRET` is correct.
3. Verify the webhook endpoint path matches exactly what was registered.
4. Check Shopify Admin > Settings > Notifications > Webhooks for delivery status.
5. Ensure the backend service is healthy and accepting connections.

### Issue 4: Oracle Cloud API connection fails

**Symptoms:**
- Sync jobs fail with `ORACLE_CONNECTION_ERROR`.
- Logs show authentication failures or connection timeouts.

**Solutions:**
1. Verify Oracle Cloud credentials in the app's Configuration page.
2. Test the Oracle Cloud REST API directly:
   ```bash
   curl -u "username:password" \
     "https://your-instance.fa.us2.oraclecloud.com/fscmRestApi/resources/11.13.18.05/items?limit=1"
   ```
3. Ensure the API user has the correct roles assigned (see [Step 4](#step-4-oracle-cloud-setup)).
4. Check if your Oracle Cloud instance allows connections from your server's IP address.
5. Verify the REST services are enabled for your Oracle Cloud instance.

### Issue 5: RabbitMQ queues not being consumed

**Symptoms:**
- Messages pile up in queues (visible in RabbitMQ Management UI).
- Worker logs show no consumer registration messages.
- Sync jobs remain in "pending" status.

**Solutions:**
1. Check the worker logs:
   ```bash
   docker-compose logs worker
   ```
2. Verify the worker is running:
   ```bash
   docker-compose ps worker
   ```
3. Check RabbitMQ Management UI (http://localhost:15672) -- verify queues have consumers.
4. Ensure `RABBITMQ_URL` in `.env` is correct and the worker can reach RabbitMQ.
5. Restart the worker:
   ```bash
   docker-compose restart worker
   ```

---

## Next Steps

Now that the app is installed, proceed to the **[Configuration Guide](CONFIGURATION.md)** for detailed instructions on setting up field mappings, sync schedules, and billing.

For end-user instructions, see the **[User Manual](USER_MANUAL.md)**.
