-- ============================================================================
-- Table: stores
-- Tracks Shopify stores that have installed the integration app.
-- ============================================================================
INSERT INTO stores (id, shopify_domain, access_token, scope, is_active) VALUES
-- 1. Default/Test Store (Matches your original mappings insert)
('00000000-0000-0000-0000-000000000000', 'hand-test.myshopify.com', 'shpua_1234567890abcdef1234567890abcdef', 'read_products,write_products,read_orders,write_orders', TRUE);


-- ============================================================================
-- Table: oracle_credentials
-- Stores Oracle Netsuite / ERP connection credentials per store.
-- Credentials are encrypted at the application layer before storage.
-- ============================================================================



-- ============================================================================
-- Table: field_mappings
-- Defines how Shopify fields map to Oracle fields for each entity type
-- and sync direction. Supports JSON transform rules for complex mappings.
-- ============================================================================



-- ============================================================================
-- Table: sync_configs
-- Configuration for each entity type's sync behaviour: frequency, batch
-- sizes, conflict resolution strategy, and scheduling.
-- ============================================================================



-- ============================================================================
-- Table: sync_jobs
-- Tracks every synchronization job execution: status, progress, timing,
-- and error summaries for observability and retry logic.
-- ============================================================================



-- ============================================================================
-- Table: sync_logs
-- Granular per-record audit trail for every sync job. Captures source and
-- target data, conflict information, and error messages for debugging.
-- ============================================================================



-- ============================================================================
-- Table: webhook_registrations
-- Tracks Shopify webhook registrations per store so the app knows which
-- webhooks to maintain and can re-register them if needed.
-- ============================================================================



-- ============================================================================
-- Table: billing_subscriptions
-- Manages Shopify Billing API subscription records per store, including
-- plan name, charge status, amount, and trial period.
-- ============================================================================



-- ============================================================================
-- Table: gdpr_requests
-- Logs GDPR data requests from Shopify (data request, data erasure, shop
-- redact) to ensure compliance processing is tracked.
-- ============================================================================



-- ============================================================================
-- Table: audit_logs
-- Immutable audit trail for administrative actions performed within the
-- app: configuration changes, manual sync triggers, credential updates, etc.
-- ============================================================================

