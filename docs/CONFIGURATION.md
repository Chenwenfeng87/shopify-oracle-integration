# Configuration Guide

Comprehensive reference for configuring all aspects of the Shopify-Oracle Fusion Cloud Integration app.

---

## Table of Contents

1. [Shopify App Configuration](#shopify-app-configuration)
2. [Oracle Fusion Cloud Configuration](#oracle-fusion-cloud-configuration)
3. [Field Mapping Configuration](#field-mapping-configuration)
4. [Sync Schedule Configuration](#sync-schedule-configuration)
5. [Conflict Resolution Strategies](#conflict-resolution-strategies)
6. [Billing Plan Configuration](#billing-plan-configuration)
7. [Multi-store Setup](#multi-store-setup)
8. [Environment Variable Reference](#environment-variable-reference)

---

## Shopify App Configuration

### App Settings Page

In the Shopify Admin, navigate to **Apps > Shopify-Oracle Integration > Settings** to configure:

#### OAuth Scopes

The app requests the following scopes during installation:

| Scope | Purpose |
|-------|---------|
| `read_products` | Read product catalog for sync |
| `write_products` | Update products after Oracle sync |
| `read_customers` | Read customer data for sync |
| `write_customers` | Update customer data after Oracle sync |
| `read_orders` | Read order data for sync |
| `write_orders` | Update order status after Oracle sync |
| `read_inventory` | Read inventory levels |
| `write_inventory` | Update inventory after Oracle sync |
| `read_price_rules` | Read pricing rules |
| `write_price_rules` | Update pricing after Oracle sync |

> **Important:** Changing scopes requires re-installing the app on all stores.

#### Webhook Configuration

Webhooks are registered automatically during installation. The following events are subscribed:

| Shopify Event | Endpoint | Direction |
|---------------|----------|-----------|
| `products/create` | `/api/webhook/products/create` | Shopify -> Oracle |
| `products/update` | `/api/webhook/products/update` | Shopify -> Oracle |
| `products/delete` | `/api/webhook/products/delete` | Shopify -> Oracle |
| `customers/create` | `/api/webhook/customers/create` | Shopify -> Oracle |
| `customers/update` | `/api/webhook/customers/update` | Shopify -> Oracle |
| `customers/delete` | `/api/webhook/customers/delete` | Shopify -> Oracle |
| `orders/create` | `/api/webhook/orders/create` | Shopify -> Oracle |
| `orders/update` | `/api/webhook/orders/update` | Shopify -> Oracle |
| `orders/cancelled` | `/api/webhook/orders/cancelled` | Shopify -> Oracle |
| `inventory_levels/update` | `/api/webhook/inventory/update` | Shopify -> Oracle |
| `app/uninstalled` | `/api/webhook/app/uninstalled` | Cleanup |
| `shop/redact` | `/api/webhook/gdpr/redaction` | GDPR compliance |
| `customers/redact` | `/api/webhook/gdpr/redaction` | GDPR compliance |
| `customers/data_request` | `/api/webhook/gdpr/data_request` | GDPR compliance |

#### App Bridge Configuration

The frontend uses Shopify App Bridge for seamless integration with Shopify Admin. Configuration is handled in `vite.config.ts` and the React app's `App.tsx`.

Key App Bridge settings:

```typescript
// Frontend App Bridge configuration
const appBridgeConfig = {
  apiKey: process.env.SHOPIFY_API_KEY,
  host: new URLSearchParams(window.location.search).get('host'),
  forceRedirect: true,     // Force redirect to Shopify Admin
};
```

---

## Oracle Fusion Cloud Configuration

### Connecting to Oracle Cloud

Navigate to **Configuration > Oracle Credentials** in the app settings.

#### Required Fields

| Field | Description | Example |
|-------|-------------|---------|
| **Instance URL** | Base URL of your Oracle Cloud instance | `https://your-instance.fa.us2.oraclecloud.com` |
| **Username** | API service account username | `integration.api@company.com` |
| **Password** | API service account password | `********` |
| **Tenant Name** | Oracle Cloud tenant/identity domain | `yourcompany` |

#### REST API Endpoints

The app uses the following Oracle Fusion Cloud REST API endpoints:

| Entity | Base Path | Version |
|--------|-----------|---------|
| **Items (Products)** | `/fscmRestApi/resources/11.13.18.05/items` | 11.13.18.05 |
| **Customers** | `/crmRestApi/resources/11.13.18.05/customers` | 11.13.18.05 |
| **Orders** | `/orderManagementRestApi/resources/11.13.18.05/orders` | 11.13.18.05 |
| **Inventory** | `/inventoryManagementRestApi/resources/11.13.18.05/inventory` | 11.13.18.05 |
| **Prices** | `/pricingRestApi/resources/11.13.18.05/prices` | 11.13.18.05 |

#### Authentication

The app uses HTTP Basic Authentication for Oracle Cloud REST API access:

```
Authorization: Basic Base64(username:password)
```

All credentials are encrypted at rest in the PostgreSQL database using AES-256 encryption before storage.

#### Connection Testing

After entering credentials, click **Test Connection** to verify:
1. The Oracle Cloud instance is reachable.
2. Authentication is successful.
3. Required REST services are enabled.

---

## Field Mapping Configuration

Field mapping defines how data fields in Shopify correspond to fields in Oracle Fusion Cloud. Configure mappings under **Configuration > Field Mappings**.

### Mapping Interface

The Field Mapper UI provides:
- **Source field selector** -- Choose a Shopify field
- **Target field selector** -- Choose the corresponding Oracle field
- **Transformation type** -- Direct copy, value mapping, formula, or custom function
- **Default value** -- Fallback value if source is empty
- **Required toggle** -- Mark mapping as required (sync fails if empty)

### Entity Types

#### Products / Items

| Shopify Field | Oracle Field | Direction | Notes |
|---------------|-------------|-----------|-------|
| `id` | `ItemNumber` | Both | Primary identifier |
| `title` | `Description` | Shopify -> Oracle | |
| `body_html` | `LongDescription` | Shopify -> Oracle | |
| `vendor` | `SupplierName` | Shopify -> Oracle | |
| `product_type` | `ItemCategory` | Shopify -> Oracle | |
| `status` | `ActiveFlag` | Shopify -> Oracle | active -> Y, draft -> N |
| `variants[].sku` | `InventoryItemNumber` | Both | |
| `variants[].price` | `UnitPrice` | Shopify -> Oracle | |
| `variants[].weight` | `Weight` | Both | Unit conversion needed |
| `variants[].inventory_quantity` | `OnHandQuantity` | Both | |
| `options` | `DescriptiveFlexField` | Shopify -> Oracle | JSON serialized |

**Example mapping configuration (JSON):**

```json
{
  "entityType": "product",
  "direction": "shopify_to_oracle",
  "mappings": [
    {
      "shopifyField": "title",
      "oracleField": "Description",
      "transformationType": "direct",
      "required": true,
      "defaultValue": ""
    },
    {
      "shopifyField": "body_html",
      "oracleField": "LongDescription",
      "transformationType": "html_to_plaintext",
      "required": false
    },
    {
      "shopifyField": "status",
      "oracleField": "ActiveFlag",
      "transformationType": "value_map",
      "valueMap": {
        "active": "Y",
        "draft": "N",
        "archived": "N"
      },
      "required": true,
      "defaultValue": "N"
    },
    {
      "shopifyField": "variants[0].price",
      "oracleField": "UnitPrice",
      "transformationType": "formula",
      "formula": "round(source * 1.0, 2)",
      "required": true
    }
  ]
}
```

#### Customers

| Shopify Field | Oracle Field | Direction | Notes |
|---------------|-------------|-----------|-------|
| `id` | `CustomerNumber` | Both | Primary identifier |
| `email` | `EmailAddress` | Both | |
| `first_name` | `FirstName` | Both | |
| `last_name` | `LastName` | Both | |
| `phone` | `PrimaryPhoneNumber` | Both | |
| `default_address.address1` | `AddressLine1` | Shopify -> Oracle | |
| `default_address.city` | `City` | Shopify -> Oracle | |
| `default_address.province` | `State` | Shopify -> Oracle | |
| `default_address.zip` | `PostalCode` | Shopify -> Oracle | |
| `default_address.country` | `Country` | Shopify -> Oracle | |
| `tax_exempt` | `TaxExemptFlag` | Shopify -> Oracle | |

#### Orders

| Shopify Field | Oracle Field | Direction | Notes |
|---------------|-------------|-----------|-------|
| `id` | `OrderNumber` | Both | Primary identifier |
| `order_number` | `SourceOrderReference` | Both | |
| `created_at` | `OrderDate` | Shopify -> Oracle | |
| `financial_status` | `PaymentStatus` | Shopify -> Oracle | Value mapping |
| `fulfillment_status` | `FulfillmentStatus` | Shopify -> Oracle | Value mapping |
| `total_price` | `TotalAmount` | Shopify -> Oracle | |
| `subtotal_price` | `SubTotal` | Shopify -> Oracle | |
| `total_tax` | `TaxAmount` | Shopify -> Oracle | |
| `shipping_lines[].price` | `ShippingCharge` | Shopify -> Oracle | |
| `line_items` | `OrderLines` | Shopify -> Oracle | Nested array mapping |

#### Inventory

| Shopify Field | Oracle Field | Direction | Notes |
|---------------|-------------|-----------|-------|
| `inventory_item_id` | `InventoryItemId` | Both | |
| `location_id` | `WarehouseCode` | Both | Location mapping |
| `available` | `OnHandQuantity` | Both | |
| `updated_at` | `LastUpdateDate` | Both | |

#### Prices

| Shopify Field | Oracle Field | Direction | Notes |
|---------------|-------------|-----------|-------|
| `price_rule_id` | `PriceRuleId` | Both | |
| `title` | `RuleName` | Shopify -> Oracle | |
| `value_type` | `DiscountType` | Shopify -> Oracle | fixed_amount -> Amount, percentage -> Percent |
| `value` | `DiscountValue` | Shopify -> Oracle | |
| `entitled_product_ids` | `ApplicableProducts` | Shopify -> Oracle | |
| `starts_at` | `StartDate` | Shopify -> Oracle | |
| `ends_at` | `EndDate` | Shopify -> Oracle | |

### Transformation Types

| Type | Description | Example |
|------|-------------|---------|
| `direct` | Copy value as-is | title -> Description |
| `value_map` | Map specific values | active -> Y, draft -> N |
| `formula` | Apply mathematical formula | `round(price * 1.0, 2)` |
| `html_to_plaintext` | Strip HTML tags | body_html -> LongDescription |
| `date_format` | Convert date format | `YYYY-MM-DD -> MM/DD/YYYY` |
| `string_concat` | Concatenate strings | first_name + ' ' + last_name -> FullName |
| `string_split` | Split string to array | tags -> CommaSeparatedList |
| `custom` | Custom JavaScript function | User-defined transformation |

---

## Sync Schedule Configuration

Configure sync schedules under **Configuration > Sync Frequency**.

### Sync Methods

#### 1. Real-time (Webhooks)

Webhooks trigger immediate sync jobs when data changes in Shopify. No additional configuration needed beyond registering webhooks (done during app installation).

**Supported entities:** Products, Customers, Orders, Inventory

#### 2. Scheduled (Cron)

Configure periodic full or incremental syncs using cron expressions.

**Cron format:** `minute hour day-of-month month day-of-week`

**Example configurations:**

```cron
# Every hour (incremental)
0 * * * *

# Daily at 2:00 AM (full sync)
0 2 * * *

# Every Monday at 3:00 AM (full sync)
0 3 * * 1

# Every 6 hours (incremental)
0 */6 * * *

# Twice daily at 8:00 and 20:00 (incremental)
0 8,20 * * *
```

**Configuration via API:**

```json
{
  "schedules": [
    {
      "entityType": "product",
      "cronExpression": "0 */2 * * *",
      "syncType": "incremental",
      "enabled": true
    },
    {
      "entityType": "customer",
      "cronExpression": "0 2 * * *",
      "syncType": "full",
      "enabled": true
    },
    {
      "entityType": "order",
      "cronExpression": "0 */4 * * *",
      "syncType": "incremental",
      "enabled": true
    },
    {
      "entityType": "inventory",
      "cronExpression": "*/30 * * * *",
      "syncType": "incremental",
      "enabled": true
    },
    {
      "entityType": "price",
      "cronExpression": "0 3 * * 1",
      "syncType": "full",
      "enabled": false
    }
  ]
}
```

#### 3. Manual

Trigger syncs on-demand from the Dashboard or Sync pages.

**API endpoint for manual sync:**

```bash
curl -X POST http://localhost:3000/api/sync/trigger \
  -H "Content-Type: application/json" \
  -d '{
    "entityType": "product",
    "syncType": "full",
    "storeId": "store-uuid-here"
  }'
```

### Sync Types

| Type | Description | When to Use |
|------|-------------|-------------|
| `full` | Sync all entities of the type | Initial setup, recovery after errors, weekly reconciliation |
| `incremental` | Sync only records changed since last sync | Regular operation, efficient for large datasets |
| `webhook` | Real-time sync triggered by webhook | Immediate updates for critical data |

### Sync Job Statuses

| Status | Description |
|--------|-------------|
| `pending` | Job created, waiting to be picked up by worker |
| `processing` | Worker is actively processing the job |
| `completed` | Sync completed successfully |
| `partial` | Some records succeeded, some failed |
| `failed` | Job could not complete |
| `cancelled` | Job was manually cancelled |

---

## Conflict Resolution Strategies

Configure conflict resolution under **Settings > Sync Settings**.

When both Shopify and Oracle have made changes to the same record since the last sync, a conflict occurs. Choose how the app handles these conflicts.

### Strategy 1: Shopify Wins

Shopify data overwrites Oracle data in all conflicts.

**Best for:** When Shopify is the source of truth for product catalogs, pricing, and customer data.

```json
{
  "conflictStrategy": "shopify_wins",
  "notifyOnConflict": true
}
```

### Strategy 2: Oracle Wins

Oracle data overwrites Shopify data in all conflicts.

**Best for:** When Oracle is the source of truth for inventory levels, pricing rules, or financial data.

```json
{
  "conflictStrategy": "oracle_wins",
  "notifyOnConflict": true
}
```

### Strategy 3: Timestamp-based (Last Writer Wins)

The system with the most recent `updated_at` timestamp wins.

**Best for:** General use when both systems are equally authoritative, depending on which changed last.

```json
{
  "conflictStrategy": "timestamp",
  "notifyOnConflict": false
}
```

### Strategy 4: Manual Review

Conflicts are flagged and no automatic resolution is applied. An admin must review and resolve each conflict through the dashboard.

**Best for:** Critical data (orders, financial records) where automatic decisions could have significant consequences.

```json
{
  "conflictStrategy": "manual",
  "notifyOnConflict": true,
  "notificationEmail": "admin@company.com"
}
```

### Per-Entity Strategy Override

You can override the global strategy for specific entity types:

```json
{
  "globalStrategy": "timestamp",
  "entityOverrides": {
    "order": "manual",
    "inventory": "oracle_wins",
    "product": "shopify_wins",
    "customer": "timestamp",
    "price": "oracle_wins"
  }
}
```

### Conflict Review Dashboard

When `manual` strategy is selected, conflicts appear in the **Sync > Conflicts** view:

| Column | Description |
|--------|-------------|
| **Entity** | Type and ID of the conflicting record |
| **Shopify Value** | Current value in Shopify |
| **Oracle Value** | Current value in Oracle |
| **Field** | Specific field with conflict |
| **Last Shopify Update** | Timestamp of last change in Shopify |
| **Last Oracle Update** | Timestamp of last change in Oracle |
| **Actions** | Choose Shopify, Oracle, or custom value |

---

## Billing Plan Configuration

Billing is handled through Shopify's Billing API, allowing you to charge merchants directly through their Shopify bill.

### Plan Types

#### Usage-based Plan

```json
{
  "planName": "Per-Sync Usage",
  "planType": "usage",
  "tier": "growth",
  "features": [
    "Real-time webhook sync",
    "5,000 sync operations/month",
    "Field mapping",
    "Basic dashboard",
    "Email support"
  ],
  "pricing": {
    "monthlyBase": 29.99,
    "perSyncOperation": 0.01,
    "maxOperations": 5000
  }
}
```

#### Subscription Plan

```json
{
  "planName": "Enterprise",
  "planType": "subscription",
  "tier": "enterprise",
  "features": [
    "Real-time webhook sync",
    "Unlimited sync operations",
    "Advanced field mapping with custom functions",
    "Multi-store support (up to 5)",
    "Priority support",
    "SLA guarantee",
    "Dedicated account manager"
  ],
  "pricing": {
    "monthly": 199.99,
    "annual": 1999.99
  }
}
```

### Available Plans

| Plan | Price | Sync Ops | Stores | Support |
|------|-------|----------|--------|---------|
| **Starter** | $9.99/mo | 1,000/mo | 1 | Email |
| **Growth** | $29.99/mo | 5,000/mo | 3 | Email + Chat |
| **Enterprise** | $199.99/mo | Unlimited | 5 | Priority |

---

## Multi-store Setup

### Adding a Store

1. Navigate to **Settings > Multi-Store**.
2. Click **Add Store**.
3. Enter the store's myshopify.com domain.
4. The app will guide the merchant through OAuth installation on the new store.

### Store Configuration

Each store can have independent settings:

| Setting | Description |
|---------|-------------|
| **Store Domain** | Shopify store domain |
| **Oracle Instance** | Oracle Cloud instance for this store |
| **Field Mappings** | Separate field mappings per store |
| **Sync Schedules** | Separate sync schedules per store |
| **Conflict Strategy** | Separate conflict resolution per store |
| **Active** | Enable/disable sync for this store |

### Oracle Cloud Instance Mapping

You can map different stores to different Oracle Cloud instances:

```
Store 1 (us-store.myshopify.com) -> Oracle US Instance
Store 2 (eu-store.myshopify.com) -> Oracle EU Instance
Store 3 (jp-store.myshopify.com) -> Oracle APAC Instance
```

---

## Environment Variable Reference

### Application Settings

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | Runtime environment (`development`, `production`, `test`) |
| `PORT` | No | `3000` | Backend server port |
| `LOG_LEVEL` | No | `debug` | Logging verbosity (`error`, `warn`, `info`, `debug`) |
| `FRONTEND_URL` | No | `http://localhost:3001` | Frontend URL for CORS configuration |

### Shopify Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SHOPIFY_API_KEY` | **Yes** | -- | Shopify App API key |
| `SHOPIFY_API_SECRET` | **Yes** | -- | Shopify App API secret |
| `SHOPIFY_SCOPES` | No | (see .env.example) | Comma-separated OAuth scopes |
| `SHOPIFY_APP_URL` | **Yes** | -- | Public HTTPS URL of the app |

### Database

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | **Yes** | `postgresql://postgres:postgres@postgres:5432/shopify_oracle_int` | PostgreSQL connection string |

### Redis

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `REDIS_URL` | **Yes** | `redis://redis:6379` | Redis connection string |
| `REDIS_PREFIX` | No | `shopify-oracle:` | Key prefix for Redis |

### RabbitMQ

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RABBITMQ_URL` | **Yes** | `amqp://rabbitmq:5672` | RabbitMQ connection string |
| `RABBITMQ_PREFETCH` | No | `10` | Number of messages prefetched per consumer |

### Encryption

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ENCRYPTION_KEY` | **Yes** | -- | 32-byte hex string for AES-256 encryption of credentials |

### Error Tracking

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SENTRY_DSN` | No | -- | Sentry DSN for error tracking |
| `SENTRY_ENVIRONMENT` | No | `$NODE_ENV` | Sentry environment tag |

### Worker

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HEARTBEAT_INTERVAL_MS` | No | `60000` | Worker health check interval in milliseconds |

### Oracle Cloud (Stored in Database, not .env)

These are configured through the app UI and stored encrypted in the database:

| Field | Description |
|-------|-------------|
| `ORACLE_CLOUD_HOST` | Oracle Cloud instance base URL |
| `ORACLE_CLOUD_USER` | Oracle Cloud API username |
| `ORACLE_CLOUD_PASS` | Oracle Cloud API password |
| `ORACLE_CLOUD_TENANT` | Oracle Cloud tenant/identity domain |

---

## Next Steps

After configuring the app, refer to the **[User Manual](USER_MANUAL.md)** for instructions on daily usage, monitoring syncs, and managing your integration.
