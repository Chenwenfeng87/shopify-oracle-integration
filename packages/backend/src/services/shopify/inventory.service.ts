import { ShopifyClient } from './shopify-client';
import { logger } from '../../utils/logger';
import type { ShopifyInventoryLevel, ShopifyInventoryItem } from '@shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GetInventoryItemsParams {
  limit?: number;
  page_info?: string;
  ids?: string;
  sku?: string;
  created_at_min?: string;
  created_at_max?: string;
  updated_at_min?: string;
  updated_at_max?: string;
}

export interface InventoryAdjustment {
  inventoryItemId: number;
  locationId: number;
  available: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ShopifyInventoryService {
  constructor(private readonly client: ShopifyClient) {}

  // -------------------------------------------------------------------------
  // Inventory Levels
  // -------------------------------------------------------------------------

  /**
   * Get inventory levels for specific inventory items at a location.
   *
   * This endpoint requires at least one `inventoryItemIds` value.
   * Shopify limits the `inventory_item_ids` query parameter to 50 items per call.
   */
  async getInventoryLevels(
    inventoryItemIds: number[],
    locationId: number,
  ): Promise<ShopifyInventoryLevel[]> {
    if (inventoryItemIds.length === 0) {
      return [];
    }

    const allLevels: ShopifyInventoryLevel[] = [];

    // Batch in chunks of 50 because Shopify limits the parameter size
    const chunkSize = 50;
    for (let i = 0; i < inventoryItemIds.length; i += chunkSize) {
      const chunk = inventoryItemIds.slice(i, i + chunkSize);

      const response = await this.client.get<{ inventory_levels: ShopifyInventoryLevel[] }>(
        '/inventory_levels.json',
        {
          inventory_item_ids: chunk.join(','),
          location_ids: locationId,
        },
      );

      const levels = response.inventory_levels || [];
      allLevels.push(...levels);
    }

    return allLevels;
  }

  /**
   * Set the inventory level for a specific inventory item at a location.
   * This is an idempotent operation that sets the available quantity.
   * The location must already be connected to the inventory item.
   */
  async setInventoryLevel(
    inventoryItemId: number,
    locationId: number,
    available: number,
  ): Promise<ShopifyInventoryLevel> {
    logger.info('Setting Shopify inventory level', {
      inventoryItemId,
      locationId,
      available,
    });

    const response = await this.client.post<{ inventory_level: ShopifyInventoryLevel }>(
      '/inventory_levels/set.json',
      {
        inventory_item_id: inventoryItemId,
        location_id: locationId,
        available,
      },
    );

    return response.inventory_level;
  }

  /**
   * Connect an inventory item to a location.
   * This must be done before setting inventory levels.
   */
  async connectInventoryLevel(
    inventoryItemId: number,
    locationId: number,
  ): Promise<void> {
    logger.info('Connecting inventory item to location', {
      inventoryItemId,
      locationId,
    });

    await this.client.post('/inventory_levels/connect.json', {
      inventory_item_id: inventoryItemId,
      location_id: locationId,
    });
  }

  // -------------------------------------------------------------------------
  // Locations
  // -------------------------------------------------------------------------

  /**
   * Get all locations for the store.
   */
  async getLocations(): Promise<Array<{ id: number; name: string }>> {
    const response = await this.client.get<{ locations: Array<{ id: number; name: string }> }>(
      '/locations.json',
    );

    return response.locations || [];
  }

  // -------------------------------------------------------------------------
  // Inventory Items
  // -------------------------------------------------------------------------

  /**
   * Get a single inventory item by ID.
   */
  async getInventoryItem(inventoryItemId: number): Promise<ShopifyInventoryItem> {
    const response = await this.client.get<{ inventory_item: ShopifyInventoryItem }>(
      `/inventory_items/${inventoryItemId}.json`,
    );

    return response.inventory_item;
  }

  /**
   * Get inventory items with optional filtering.
   */
  async getInventoryItems(params: GetInventoryItemsParams = {}): Promise<ShopifyInventoryItem[]> {
    const queryParams: Record<string, unknown> = {
      limit: Math.min(params.limit ?? 50, 250),
    };

    if (params.page_info) {
      queryParams.page_info = params.page_info;
    } else {
      if (params.ids) queryParams.ids = params.ids;
      if (params.sku) queryParams.sku = params.sku;
      if (params.created_at_min) queryParams.created_at_min = params.created_at_min;
      if (params.created_at_max) queryParams.created_at_max = params.created_at_max;
      if (params.updated_at_min) queryParams.updated_at_min = params.updated_at_min;
      if (params.updated_at_max) queryParams.updated_at_max = params.updated_at_max;
    }

    const response = await this.client.get<{ inventory_items: ShopifyInventoryItem[] }>(
      '/inventory_items.json',
      queryParams,
    );

    return response.inventory_items || [];
  }

  // -------------------------------------------------------------------------
  // Bulk operations
  // -------------------------------------------------------------------------

  /**
   * Bulk adjust inventory levels for multiple items.
   * Each adjustment is performed sequentially because the Shopify REST API
   * does not support a bulk inventory adjustment endpoint.
   * The GraphQL `inventoryBulkAdjustQuantityAtLocation` is available but
   * requires the GraphQL client; using REST for consistency.
   */
  async bulkAdjustInventory(adjustments: InventoryAdjustment[]): Promise<void> {
    logger.info('Bulk adjusting inventory', { count: adjustments.length });

    for (const adj of adjustments) {
      try {
        // First ensure the inventory level is connected
        try {
          await this.connectInventoryLevel(adj.inventoryItemId, adj.locationId);
        } catch {
          // Connection may already exist; ignore error and proceed
        }

        await this.setInventoryLevel(adj.inventoryItemId, adj.locationId, adj.available);
      } catch (error) {
        logger.error('Failed to adjust inventory for item', {
          inventoryItemId: adj.inventoryItemId,
          locationId: adj.locationId,
          error: (error as Error).message,
        });
        // Continue with remaining adjustments
      }
    }

    logger.info('Bulk inventory adjustment complete', { count: adjustments.length });
  }
}

export default ShopifyInventoryService;
