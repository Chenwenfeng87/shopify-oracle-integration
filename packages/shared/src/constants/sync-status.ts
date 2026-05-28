import type { SyncStatus, EntityType, SyncTrigger, ConflictStrategy, SyncDirection } from '../types';

/**
 * Human-readable labels for each sync status value.
 */
export const SYNC_STATUS_LABELS: Record<SyncStatus, string> = {
  pending: 'Pending',
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  partial: 'Partially Completed',
};

/**
 * Human-readable labels for each entity type.
 */
export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  item: 'Item',
  customer: 'Customer',
  order: 'Order',
  price: 'Price',
  inventory: 'Inventory',
};

/**
 * Human-readable labels for each sync trigger type.
 */
export const SYNC_TRIGGER_LABELS: Record<SyncTrigger, string> = {
  manual: 'Manual',
  scheduled: 'Scheduled',
  webhook: 'Webhook',
};

/**
 * Human-readable labels for each conflict resolution strategy.
 */
export const CONFLICT_STRATEGY_LABELS: Record<ConflictStrategy, string> = {
  source_wins: 'Source Wins',
  target_wins: 'Target Wins',
  manual: 'Manual Resolution',
  merge: 'Merge Fields',
};

/**
 * Human-readable labels for each sync direction.
 */
export const SYNC_DIRECTION_LABELS: Record<SyncDirection, string> = {
  shopify_to_oracle: 'Shopify to Oracle',
  oracle_to_shopify: 'Oracle to Shopify',
};
