# User Manual

End-user guide for managing the Shopify-Oracle Fusion Cloud Integration app.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Dashboard Overview](#dashboard-overview)
3. [Configuring Oracle Credentials](#configuring-oracle-credentials)
4. [Setting Up Field Mappings](#setting-up-field-mappings)
5. [Triggering Manual Syncs](#triggering-manual-syncs)
6. [Understanding Sync Job Statuses](#understanding-sync-job-statuses)
7. [Viewing Sync Logs and Errors](#viewing-sync-logs-and-errors)
8. [Setting Up Scheduled Syncs](#setting-up-scheduled-syncs)
9. [Managing Conflicts](#managing-conflicts)
10. [Multi-store Management](#multi-store-management)
11. [Billing Management](#billing-management)
12. [GDPR Compliance Features](#gdpr-compliance-features)
13. [FAQ](#faq)
14. [Glossary of Terms](#glossary-of-terms)

---

## Getting Started

### Installing the App

1. Go to the **Shopify App Store** or click the **Install** link provided by your administrator.
2. Review the requested permissions and click **Install**.
3. You will be redirected to the app dashboard within your Shopify Admin.
4. Complete the initial setup wizard:
   - **Step 1:** Enter your Oracle Fusion Cloud credentials.
   - **Step 2:** Select which entities to sync (Products, Customers, Orders, Inventory, Prices).
   - **Step 3:** Choose your sync direction (Shopify to Oracle, Oracle to Shopify, or Bidirectional).
   - **Step 4:** Configure the initial field mappings (default mappings are pre-loaded).
   - **Step 5:** Select your billing plan.

### First-time Setup Checklist

Once installed, complete these steps in order:

1. [Configure Oracle credentials](#configuring-oracle-credentials)
2. [Review and customize field mappings](#setting-up-field-mappings)
3. [Test the connection](#testing-the-connection)
4. [Run an initial manual sync](#triggering-manual-syncs)
5. [Set up scheduled syncs](#setting-up-scheduled-syncs)
6. [Choose conflict resolution strategy](#managing-conflicts)

---

## Dashboard Overview

The Dashboard is your central view of the integration's health and activity. Access it by clicking **Dashboard** in the app's navigation menu.

### Dashboard Widgets

#### Sync Status Summary

```
┌─────────────────────────────────────────────────────────────┐
│  Sync Status Summary                                        │
├─────────────────────────────────────────────────────────────┤
│  ● All systems healthy                    Last sync: 2 min  │
│                                                             │
│  ┌─────────────┬────────────┬──────────┬─────────────────┐  │
│  │ Entity      │ Status     │ Records  │ Last Synced     │  │
│  ├─────────────┼────────────┼──────────┼─────────────────┤  │
│  │ Products    │ ● Synced   │ 1,234    │ 2 min ago       │  │
│  │ Customers   │ ● Synced   │ 5,678    │ 5 min ago       │  │
│  │ Orders      │ ● Synced   │ 890      │ 1 hour ago      │  │
│  │ Inventory   │ ⚠ Partial  │ --       │ 15 min ago      │  │
│  │ Prices      │ ○ Pending  │ --       │ Never           │  │
│  └─────────────┴────────────┴──────────┴─────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

#### Quick Stats

- **Total Records Synced:** Overall count of records synchronized across all entity types.
- **Sync Operations This Month:** Tracks usage against your billing plan limit.
- **Failed Syncs (24h):** Number of failed sync jobs in the last 24 hours.
- **Pending Conflicts:** Number of records awaiting manual conflict resolution.
- **Active Webhooks:** Number of registered Shopify webhooks currently active.
- **Avg Sync Duration:** Average time to complete a sync job.

#### Recent Activity Feed

A chronological list of recent sync activity showing:
- Sync job completions (successful, partial, failed)
- Conflict detections
- Configuration changes
- Webhook events processed

#### System Health Panel

```
┌─────────────────────────────────────────────────────────────┐
│  System Health                                              │
│                                                             │
│  ● Database       Connected     Response: 2ms              │
│  ● Redis          Connected     Response: 1ms              │
│  ● RabbitMQ       Connected     Queues: 5/5 consumers      │
│  ● Oracle API     Connected     Response: 145ms            │
│  ● Shopify API    Connected     Response: 230ms            │
│                                                             │
│  Uptime: 14d 6h 23m    │    Version: 1.0.0                │
└─────────────────────────────────────────────────────────────┘
```

---

## Configuring Oracle Credentials

### Step-by-step Instructions

1. Navigate to **Configuration > Oracle Credentials**.
2. Fill in the following fields:

   | Field | Description | Where to Find |
   |-------|-------------|---------------|
   | **Instance URL** | Your Oracle Cloud base URL | Oracle Cloud login page URL |
   | **Username** | API service account username | Oracle Cloud Security Console |
   | **Password** | API service account password | Generated when creating API user |
   | **Tenant Name** | Identity domain/tenant name | Oracle Cloud Account Settings |

3. Click **Save Credentials**.
4. Click **Test Connection** to verify the credentials work.

### Connection Test Results

| Result | Meaning | Action |
|--------|---------|--------|
| **Connection successful** | Credentials are valid and services are reachable | Proceed to set up field mappings |
| **Authentication failed** | Username or password is incorrect | Verify credentials and retry |
| **Service unavailable** | Oracle Cloud instance is not reachable | Check instance URL and network connectivity |
| **Insufficient privileges** | API user lacks required roles | Contact Oracle Cloud administrator |

### Updating Credentials

You can update your Oracle credentials at any time. The credentials are encrypted and stored securely. A history of credential changes is maintained for audit purposes.

---

## Setting Up Field Mappings

Field mappings tell the app which Shopify fields correspond to which Oracle Cloud fields.

### Accessing the Field Mapper

Navigate to **Configuration > Field Mappings**.

### Selecting an Entity

From the dropdown, select the entity type you want to configure:
- **Product** -- Product catalog items
- **Customer** -- Customer records
- **Order** -- Sales orders
- **Inventory** -- Inventory levels
- **Price** -- Pricing rules

### Understanding the Mapping Interface

```
┌─────────────────────────────────────────────────────────────────────┐
│  Field Mappings: Product (Shopify → Oracle)                         │
├─────────────────────────────────────────────────────────────────────┤
│  ┌────────────┬────────────┬──────────────┬────────┬─────────────┐  │
│  │ Shopify    │ Oracle     │ Transform    │ Req?   │ Actions     │  │
│  ├────────────┼────────────┼──────────────┼────────┼─────────────┤  │
│  │ title      │ Desc.      │ Direct       │ ✓      │ [Edit] [X]  │  │
│  │ status     │ ActiveFlag │ Value Map    │ ✓      │ [Edit] [X]  │  │
│  │ variants[0]│ UnitPrice  │ Formula      │ ✓      │ [Edit] [X]  │  │
│  │ .price     │            │              │        │             │  │
│  │ vendor     │ Supplier   │ Direct       │        │ [Edit] [X]  │  │
│  │ ...        │ ...        │ ...          │ ...    │ ...         │  │
│  └────────────┴────────────┴──────────────┴────────┴─────────────┘  │
│                                      [Add Mapping]  [Save All]     │
└─────────────────────────────────────────────────────────────────────┘
```

### Adding a New Mapping

1. Click **Add Mapping**.
2. **Select Shopify Field** -- Choose from the dropdown list of Shopify fields for the selected entity.
3. **Select Oracle Field** -- Choose from the dropdown list of Oracle Cloud fields.
4. **Choose Transformation Type:**
   - **Direct** -- Values are copied as-is (for simple string/number fields).
   - **Value Map** -- Map specific source values to specific target values (e.g., `active` -> `Y`, `draft` -> `N`).
   - **Formula** -- Apply a calculation (e.g., `round(price * 1.08, 2)` for tax adjustment).
   - **Date Format** -- Convert between date formats.
   - **Custom** -- Write a custom transformation function.
5. **Set as Required?** -- If checked, the sync will fail if the source value is empty.
6. **Default Value** -- Value to use if the source is empty (only for non-required fields).
7. Click **Save Mapping**.

### Editing Value Maps

For **Value Map** transformations, you'll see a table where you define mappings:

```
Shopify Value        Oracle Value
─────────────────────────────────
active          ──►  Y
draft           ──►  N
archived        ──►  N

[Add Row]  [Remove Selected]
```

### Testing Mappings

Before saving, you can test your mappings:

1. Click **Test Mapping**.
2. Enter a sample Shopify value.
3. The system shows the transformed Oracle value.
4. Verify the output is correct.

### Default Mappings

Default mappings are provided for all entity types and can be customized. If you need to reset to defaults, click **Reset to Defaults** in the Field Mapper settings.

---

## Triggering Manual Syncs

### From the Dashboard

1. Navigate to **Sync > Manual Sync**.
2. Select the entity type(s) to sync:
   - Products
   - Customers
   - Orders
   - Inventory
   - Prices
3. Select the sync type:
   - **Full Sync** -- Syncs all records (can be slow for large datasets).
   - **Incremental Sync** -- Syncs only records changed since last sync.
4. Click **Start Sync**.

### From the API

```bash
curl -X POST https://your-app.com/api/sync/trigger \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Access-Token: your-token" \
  -d '{
    "entityType": "product",
    "syncType": "full"
  }'
```

### Rate Limits

- Maximum 5 concurrent sync jobs per store.
- Manual syncs are queued if the system is busy.
- Sync operations count toward your billing plan's usage limit.

---

## Understanding Sync Job Statuses

### Status Lifecycle

```
Pending ──► Processing ──► Completed
                 │
                 ├──► Partial (some records failed)
                 │
                 └──► Failed
```

| Status | Icon | Description |
|--------|------|-------------|
| **Pending** | ⏳ | Job is queued and waiting for a worker to process it |
| **Processing** | 🔄 | Worker is actively processing the sync job |
| **Completed** | ✅ | All records were synced successfully |
| **Partial** | ⚠️ | Some records succeeded, some failed (see logs for details) |
| **Failed** | ❌ | The job could not complete (see logs for error details) |
| **Cancelled** | 🚫 | Job was manually cancelled by an admin |

### Viewing Job Details

1. Navigate to **Sync > Sync Jobs**.
2. Click on any job to view its details.
3. The detail view shows:
   - **Basic Info:** Entity type, sync type, duration, records processed.
   - **Progress:** Records succeeded, failed, skipped.
   - **Timeline:** Start time, end time, duration.
   - **Error Summary:** If the job failed or completed partially.
   - **Logs:** Detailed logs for the job.

---

## Viewing Sync Logs and Errors

### Log Viewer

Navigate to **Logs** to access the log viewer.

**Log viewer features:**
- **Filter by entity:** Show logs for specific entity types.
- **Filter by status:** Show logs for successful, failed, or partial syncs.
- **Filter by date range:** Select a custom date range.
- **Search:** Search for specific terms in log messages.
- **Export:** Download logs as CSV or JSON.

### Log Entry Details

Each log entry includes:

| Field | Description |
|-------|-------------|
| **Timestamp** | When the event occurred |
| **Level** | INFO, WARN, ERROR, DEBUG |
| **Entity** | Entity type (product, customer, etc.) |
| **Entity ID** | Record ID in the source system |
| **Action** | Action performed (create, update, delete, skip) |
| **Message** | Human-readable description |
| **Error Code** | Machine-readable error code |
| **Details** | Additional context (JSON) |
| **Job ID** | Associated sync job identifier |

### Common Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| `SHOPIFY_API_ERROR` | Shopify API request failed | Check Shopify API status, verify token |
| `ORACLE_API_ERROR` | Oracle API request failed | Check Oracle Cloud status, verify credentials |
| `ORACLE_CONNECTION_ERROR` | Cannot connect to Oracle Cloud | Verify network and credentials |
| `FIELD_MAPPING_ERROR` | Field mapping transformation failed | Review field mappings for the entity |
| `VALIDATION_ERROR` | Data failed validation | Check for required fields or format issues |
| `RATE_LIMIT_EXCEEDED` | API rate limit hit | Wait and retry, or upgrade plan |
| `CONFLICT_DETECTED` | Data conflict requires resolution | Review conflicts in the Conflicts view |
| `AUTHENTICATION_ERROR` | Authentication failed | Re-install app or refresh token |
| `TIMEOUT_ERROR` | Operation timed out | Check network, try again with fewer records |
| `INVALID_DATA` | Data format is invalid | Check field mappings and data format |

---

## Setting Up Scheduled Syncs

### Accessing Sync Scheduler

Navigate to **Configuration > Sync Frequency**.

### Adding a Schedule

1. Click **Add Schedule**.
2. Select the **Entity Type** (Product, Customer, Order, Inventory, Price).
3. Select the **Sync Type** (Full or Incremental).
4. Enter a **Cron Expression** or use the visual editor:
   - **Every hour:** `0 * * * *`
   - **Every 6 hours:** `0 */6 * * *`
   - **Daily at midnight:** `0 0 * * *`
   - **Daily at 2:00 AM:** `0 2 * * *`
   - **Weekly on Monday:** `0 0 * * 1`
   - **Custom:** Enter any valid cron expression
5. Toggle **Enabled** to activate the schedule.
6. Click **Save Schedule**.

### Visual Cron Editor

The visual editor helps you build cron expressions without memorizing the format:

```
┌───────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌───────────── day of month (1 - 31)
│ │ │ ┌───────────── month (1 - 12)
│ │ │ │ ┌───────────── day of week (0 - 7, 0=Sun)
│ │ │ │ │
* * * * *
```

### Managing Schedules

- **Enable/Disable:** Toggle individual schedules on/off.
- **Edit:** Change the cron expression or sync type.
- **Delete:** Remove a schedule.
- **Run Now:** Trigger the schedule immediately without changing its cron timing.

---

## Managing Conflicts

### What is a Conflict?

A conflict occurs when a record has been modified in both Shopify and Oracle since the last successful sync, and both versions differ.

### Viewing Conflicts

Navigate to **Sync > Conflicts** to see all unresolved conflicts.

The conflicts view shows a table with:

| Column | Description |
|--------|-------------|
| **Entity** | Type of entity (product, customer, etc.) |
| **Shopify ID** | Record ID in Shopify |
| **Oracle ID** | Record ID in Oracle |
| **Field** | Specific field with conflicting values |
| **Shopify Value** | Current value in Shopify |
| **Oracle Value** | Current value in Oracle |
| **Last Shopify Update** | When Shopify value was last changed |
| **Last Oracle Update** | When Oracle value was last changed |
| **Actions** | Resolve or ignore |

### Resolving Conflicts

1. Click **Review** on a conflict entry.
2. Compare the values side by side.
3. Choose a resolution:
   - **Use Shopify Value** -- Overwrites Oracle with Shopify's value.
   - **Use Oracle Value** -- Overwrites Shopify with Oracle's value.
   - **Custom Value** -- Enter a value different from both.
4. Optionally, apply the same resolution to all conflicts for this field.
5. Click **Resolve**.

### Bulk Resolution

For multiple conflicts with the same field:

1. Select the conflicts using checkboxes.
2. Click **Bulk Resolve**.
3. Choose the resolution strategy.
4. Click **Apply to All Selected**.

### Conflict History

Resolved conflicts are logged and viewable in the **Conflict History** tab, showing:
- Date and time of resolution
- Resolution chosen
- Who resolved the conflict
- Previous and new values

---

## Multi-store Management

### Adding a Store

1. Navigate to **Settings > Multi-Store**.
2. Click **Add Store**.
3. Enter the store's domain (e.g., `my-store.myshopify.com`).
4. Click **Connect Store**.
5. You will be redirected to the new store to authorize installation.

### Switching Between Stores

Use the store selector dropdown at the top of the app to switch between connected stores. Each store has its own:
- Dashboard
- Field mappings
- Sync schedules
- Sync history
- Configuration

### Store-specific Settings

Each store can have independent settings:

| Setting | Description |
|---------|-------------|
| **Oracle Instance** | Different Oracle Cloud instance per store |
| **Sync Direction** | Unidirectional or bidirectional per entity |
| **Field Mappings** | Custom field mappings per store |
| **Conflict Strategy** | Independent conflict resolution per store |
| **Sync Schedule** | Independent sync schedules per store |
| **Enabled Entities** | Choose which entities sync for this store |

### Removing a Store

1. Navigate to **Settings > Multi-Store**.
2. Click the store you want to remove.
3. Click **Remove Store**.
4. Confirm the removal.

> **Note:** Removing a store will delete all associated sync data, logs, and configurations for that store. The app will also be uninstalled from the store automatically.

---

## Billing Management

### Viewing Your Plan

Navigate to **Billing** to see:
- Current plan name and tier
- Features included
- Usage statistics (sync operations used this month)
- Next billing date

### Changing Plans

1. Navigate to **Billing**.
2. Click **Change Plan**.
3. Compare available plans.
4. Select your new plan.
5. Confirm the change.

### Usage Tracking

The billing page shows:
- **Sync Operations:** Number of sync operations used this month vs. limit.
- **API Calls:** Number of API calls made to Shopify and Oracle.
- **Data Volume:** Total records synced.

---

## GDPR Compliance Features

### Overview

The app automatically handles Shopify's mandatory GDPR webhooks. When Shopify sends a GDPR data request or erasure request, the app processes it and responds within the required timeframe.

### Data Subject Request

When a customer requests their data:

1. Shopify sends a `customers/data_request` webhook to the app.
2. The app retrieves all stored data for the customer (sync logs, field mappings, credentials).
3. A report is generated and sent to the store owner's email.
4. The request is logged for compliance purposes.

### Data Erasure

When a customer requests data deletion:

1. Shopify sends a `customers/redact` webhook to the app.
2. The app deletes all stored data for the customer.
3. Any Oracle Cloud records related to the customer are flagged for review.
4. A confirmation is sent to Shopify.
5. The erasure is logged for compliance purposes.

### Shop Redaction

When a store is deleted or the app is uninstalled:

1. Shopify sends a `shop/redact` webhook.
2. The app deletes all store-related data.
3. All sync jobs for the store are cancelled.
4. The redaction is logged.

### Data Storage and Retention

| Data Type | Storage Location | Retention |
|-----------|-----------------|-----------|
| Sync logs | PostgreSQL | 90 days |
| Sync job records | PostgreSQL | 90 days |
| Field mappings | PostgreSQL | Until store is removed |
| Credentials | PostgreSQL (encrypted) | Until store is removed |
| Shopify access tokens | PostgreSQL | Until app is uninstalled |
| Cache data | Redis | 24 hours |

---

## FAQ

### 1. How long does a full sync take?

A full sync depends on the volume of data. As a guideline:
- **Small store (< 1,000 products):** 2-5 minutes
- **Medium store (1,000 - 10,000 products):** 5-20 minutes
- **Large store (10,000 - 100,000 products):** 20-90 minutes

### 2. What happens if a sync fails?

If a sync job fails:
1. The job is marked as **Failed** or **Partial** depending on how many records were affected.
2. Failed records are logged with error details.
3. You can view the error details in the **Logs** section.
4. You can retry failed records from the **Sync Jobs** detail page.
5. For webhook-triggered syncs, the system automatically retries up to 3 times with exponential backoff.

### 3. Can I sync only specific products?

Yes. You can:
- Filter products by vendor, product type, or collection in field mappings.
- Exclude specific products by adding them to a sync exclusion list.
- Set up different sync rules for different product categories.

### 4. How do I handle data that exists only in Shopify or only in Oracle?

The app handles this through its **initial sync** process:
- Records that exist only in Shopify are created in Oracle.
- Records that exist only in Oracle are created in Shopify.
- Records that exist in both systems are matched by ID or SKU for synchronization.

### 5. Is my Oracle Cloud credential data secure?

Yes. All Oracle Cloud credentials are:
- Encrypted at rest using AES-256 encryption.
- Never logged or exposed in error messages.
- Only decrypted in memory when needed for API calls.
- Stored in PostgreSQL with the encryption key stored only in environment variables.
- Audited with credential change history.

### 6. Can I use the app with multiple Oracle Cloud instances?

Yes. The app supports multi-store configurations where each Shopify store can connect to a different Oracle Cloud instance. You can configure this under **Settings > Multi-Store**.

### 7. What happens when I reach my billing plan limit?

When you approach your plan limit:
- Warnings are displayed on the dashboard.
- Email notifications are sent to the store owner.
- Sync operations continue but overages may apply depending on your plan.
- You can upgrade your plan at any time from the **Billing** page.

### 8. How do I handle tax and currency differences?

Tax and currency handling is configured through field mappings:
- **Tax:** Shopify tax data can be mapped to Oracle tax codes using value mapping.
- **Currency:** A currency conversion formula can be applied in field mappings.
- These transformations are customizable per entity type.

### 9. What happens if my Shopify token expires?

If the Shopify access token expires:
1. The system logs the error and marks the job as failed.
2. The store is flagged with an authentication warning on the dashboard.
3. The merchant needs to re-authenticate by logging in to the app.
4. The app will guide you through re-authentication.

### 10. Can I test the integration without affecting live data?

Yes. We recommend:
- Using a development Shopify store for initial testing.
- Setting up a test Oracle Cloud instance or sandbox.
- Starting with a single entity type (e.g., Products) and verifying the results.
- Reviewing sync logs after each test sync.
- Running a full sync in **dry-run mode** (available under Sync > Manual Sync > "Simulate only").

---

## Glossary of Terms

| Term | Definition |
|------|------------|
| **Sync** | The process of ensuring data matches between Shopify and Oracle Cloud. |
| **Full Sync** | A complete synchronization that processes all records of an entity type. |
| **Incremental Sync** | A synchronization that processes only records changed since the last sync. |
| **Entity** | A type of data object (Product, Customer, Order, Inventory, Price). |
| **Field Mapping** | A rule that defines how a Shopify field corresponds to an Oracle Cloud field. |
| **Transformation** | A modification applied to data during sync (value mapping, formula, etc.). |
| **Conflict** | A situation where the same record has been modified in both systems since the last sync. |
| **Conflict Resolution** | The strategy used to decide which value to keep when a conflict occurs. |
| **Webhook** | An HTTP callback that Shopify sends to the app when specific events occur. |
| **OAuth** | The authorization protocol used by Shopify to grant the app access to store data. |
| **HMAC** | A cryptographic hash used by Shopify to verify webhook authenticity. |
| **App Bridge** | Shopify's JavaScript library for embedding apps in the Shopify Admin. |
| **Cron Expression** | A time-based scheduling expression used for automated syncs. |
| **Dead Letter Queue** | A RabbitMQ queue that stores messages that failed processing. |
| **Consumer** | A worker process that reads and processes messages from a queue. |
| **Producer** | The backend service that publishes sync jobs to RabbitMQ queues. |
| **Retry** | Automatic re-attempt of a failed operation with exponential backoff. |
| **Bidirectional Sync** | Synchronization that flows in both directions (Shopify -> Oracle and Oracle -> Shopify). |
| **Dry Run** | A simulated sync that shows what would happen without making any changes. |
| **Store** | A Shopify store connected to the app. |
| **Multi-store** | The ability to connect and manage multiple Shopify stores. |
| **GDPR** | General Data Protection Regulation -- EU data privacy law. |
| **Data Subject Request** | A request from an individual to access their personal data. |
| **Data Erasure** | The deletion of an individual's personal data upon request. |
| **Polaris** | Shopify's design system and component library used in the frontend. |
| **Encryption Key** | A secret key used to encrypt and decrypt Oracle Cloud credentials. |
| **Rate Limit** | A restriction on the number of API calls per time period. |
| **AES-256** | Advanced Encryption Standard with 256-bit keys -- industry-standard encryption. |
