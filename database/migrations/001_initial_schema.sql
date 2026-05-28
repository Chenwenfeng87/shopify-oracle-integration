-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- Table: stores
-- Tracks Shopify stores that have installed the integration app.
-- ============================================================================
CREATE TABLE stores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shopify_domain VARCHAR(255) UNIQUE NOT NULL,
  access_token TEXT,
  scope TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  installed_at TIMESTAMP DEFAULT NOW(),
  uninstalled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- Table: oracle_credentials
-- Stores Oracle Netsuite / ERP connection credentials per store.
-- Credentials are encrypted at the application layer before storage.
-- ============================================================================
CREATE TABLE oracle_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  base_url VARCHAR(500) NOT NULL,
  username VARCHAR(255) NOT NULL,
  password TEXT NOT NULL,
  identity_domain VARCHAR(255),
  is_valid BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(store_id)
);

-- ============================================================================
-- Table: field_mappings
-- Defines how Shopify fields map to Oracle fields for each entity type
-- and sync direction. Supports JSON transform rules for complex mappings.
-- ============================================================================
CREATE TABLE field_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('item', 'customer', 'order', 'price', 'inventory')),
  direction VARCHAR(20) NOT NULL CHECK (direction IN ('shopify_to_oracle', 'oracle_to_shopify')),
  shopify_field VARCHAR(255) NOT NULL,
  oracle_field VARCHAR(255) NOT NULL,
  transform_rule JSONB,
  is_required BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- Table: sync_configs
-- Configuration for each entity type's sync behaviour: frequency, batch
-- sizes, conflict resolution strategy, and scheduling.
-- ============================================================================
CREATE TABLE sync_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('item', 'customer', 'order', 'price', 'inventory')),
  frequency VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (frequency IN ('real_time', 'scheduled', 'manual')),
  cron_expression VARCHAR(100),
  is_enabled BOOLEAN DEFAULT TRUE,
  batch_size INTEGER DEFAULT 100 CHECK (batch_size > 0 AND batch_size <= 500),
  conflict_strategy VARCHAR(50) DEFAULT 'source_wins' CHECK (conflict_strategy IN ('source_wins', 'target_wins', 'manual', 'merge')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(store_id, entity_type)
);

-- ============================================================================
-- Table: sync_jobs
-- Tracks every synchronization job execution: status, progress, timing,
-- and error summaries for observability and retry logic.
-- ============================================================================
CREATE TABLE sync_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('item', 'customer', 'order', 'price', 'inventory')),
  direction VARCHAR(20) NOT NULL CHECK (direction IN ('shopify_to_oracle', 'oracle_to_shopify')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'running', 'completed', 'failed', 'partial')),
  trigger VARCHAR(20) NOT NULL CHECK (trigger IN ('manual', 'scheduled', 'webhook')),
  total_records INTEGER DEFAULT 0,
  processed_records INTEGER DEFAULT 0,
  failed_records INTEGER DEFAULT 0,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  error_summary JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- Table: sync_logs
-- Granular per-record audit trail for every sync job. Captures source and
-- target data, conflict information, and error messages for debugging.
-- ============================================================================
CREATE TABLE sync_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sync_job_id UUID NOT NULL REFERENCES sync_jobs(id) ON DELETE CASCADE,
  record_id VARCHAR(255) NOT NULL,
  action VARCHAR(50) NOT NULL CHECK (action IN ('created', 'updated', 'skipped', 'failed')),
  source_data JSONB,
  target_data JSONB,
  conflict_detected BOOLEAN DEFAULT FALSE,
  conflict_resolution VARCHAR(50),
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- Table: webhook_registrations
-- Tracks Shopify webhook registrations per store so the app knows which
-- webhooks to maintain and can re-register them if needed.
-- ============================================================================
CREATE TABLE webhook_registrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  topic VARCHAR(100) NOT NULL,
  webhook_id VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- Table: billing_subscriptions
-- Manages Shopify Billing API subscription records per store, including
-- plan name, charge status, amount, and trial period.
-- ============================================================================
CREATE TABLE billing_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,
  plan_name VARCHAR(100) NOT NULL,
  charge_id VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'declined', 'past_due')),
  amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  trial_ends_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- Table: gdpr_requests
-- Logs GDPR data requests from Shopify (data request, data erasure, shop
-- redact) to ensure compliance processing is tracked.
-- ============================================================================
CREATE TABLE gdpr_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  request_type VARCHAR(50) NOT NULL CHECK (request_type IN ('data_request', 'data_erasure', 'shop_redact')),
  customer_id VARCHAR(255),
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- Table: audit_logs
-- Immutable audit trail for administrative actions performed within the
-- app: configuration changes, manual sync triggers, credential updates, etc.
-- ============================================================================
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,
  details JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- Performance Indexes
-- ============================================================================
CREATE INDEX idx_stores_domain ON stores(shopify_domain);
CREATE INDEX idx_stores_active ON stores(is_active);
CREATE INDEX idx_oracle_creds_store ON oracle_credentials(store_id);
CREATE INDEX idx_field_mappings_store_entity ON field_mappings(store_id, entity_type, direction);
CREATE INDEX idx_sync_configs_store ON sync_configs(store_id);
CREATE INDEX idx_sync_jobs_store ON sync_jobs(store_id);
CREATE INDEX idx_sync_jobs_status ON sync_jobs(status);
CREATE INDEX idx_sync_jobs_entity ON sync_jobs(store_id, entity_type);
CREATE INDEX idx_sync_logs_job ON sync_logs(sync_job_id);
CREATE INDEX idx_sync_logs_created ON sync_logs(created_at DESC);
CREATE INDEX idx_webhook_registrations_store ON webhook_registrations(store_id);
CREATE INDEX idx_billing_store ON billing_subscriptions(store_id);
CREATE INDEX idx_gdpr_store ON gdpr_requests(store_id);
CREATE INDEX idx_audit_store ON audit_logs(store_id);

-- ============================================================================
-- Auto-update trigger for updated_at columns
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers to all tables with an updated_at column
CREATE TRIGGER update_stores_updated_at BEFORE UPDATE ON stores FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_oracle_credentials_updated_at BEFORE UPDATE ON oracle_credentials FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_field_mappings_updated_at BEFORE UPDATE ON field_mappings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_sync_configs_updated_at BEFORE UPDATE ON sync_configs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_sync_jobs_updated_at BEFORE UPDATE ON sync_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_billing_subscriptions_updated_at BEFORE UPDATE ON billing_subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
