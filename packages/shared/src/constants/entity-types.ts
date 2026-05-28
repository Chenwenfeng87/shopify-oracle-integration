import type { EntityType, SyncDirection } from '../types';

/**
 * The canonical list of supported entity types.
 * Used for runtime iteration and validation.
 */
export const ENTITY_TYPES = ['item', 'customer', 'order', 'price', 'inventory'] as const;

/**
 * Default sync direction and label for each entity type.
 */
export const ENTITY_SYNC_DIRECTIONS: Record<EntityType, { defaultDirection: SyncDirection; label: string }> = {
  item: {
    defaultDirection: 'shopify_to_oracle',
    label: 'Item',
  },
  customer: {
    defaultDirection: 'shopify_to_oracle',
    label: 'Customer',
  },
  order: {
    defaultDirection: 'shopify_to_oracle',
    label: 'Order',
  },
  price: {
    defaultDirection: 'oracle_to_shopify',
    label: 'Price',
  },
  inventory: {
    defaultDirection: 'oracle_to_shopify',
    label: 'Inventory',
  },
};

/**
 * Shopify OAuth scopes required by the integration.
 * These cover read access for the entity types we synchronize.
 */
export const SHOPIFY_REQUIRED_SCOPES: string[] = [
  'read_products',
  'write_products',
  'read_customers',
  'write_customers',
  'read_orders',
  'write_orders',
  'read_inventory',
  'write_inventory',
  'read_price_rules',
];

/**
 * Default number of records to process per batch.
 */
export const DEFAULT_BATCH_SIZE = 100;

/**
 * Maximum allowed batch size.
 */
export const MAX_BATCH_SIZE = 500;

/**
 * Maximum number of retry attempts for failed operations.
 */
export const MAX_RETRIES = 3;
