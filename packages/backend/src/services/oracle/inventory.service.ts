import { OracleClient } from './oracle-client';
import { logger } from '../../utils/logger';
import type { OracleInventoryItem } from '@shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InventoryListResult {
  items: OracleInventoryItem[];
  total: number;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractInventoryItems(response: unknown): { items: OracleInventoryItem[]; total: number } {
  const body = response as Record<string, unknown>;

  const items = (body.items as OracleInventoryItem[]) ||
    (body.inventoryItems as OracleInventoryItem[]) ||
    (body.results as OracleInventoryItem[]) ||
    [];

  const total =
    (body.totalResults as number) ??
    (body.count as number) ??
    items.length;

  return { items, total };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class OracleInventoryService {
  constructor(private readonly client: OracleClient) {}

  // -------------------------------------------------------------------------
  // On-Hand Quantities
  // -------------------------------------------------------------------------

  /**
   * Get on-hand inventory quantities for specified items and/or organization.
   * Oracle Fusion Cloud REST API: GET /api/inventory/onHandQuantities
   *
   * If no item IDs are provided, returns quantities for all items
   * (subject to pagination limits).
   */
  async getOnHandQuantities(
    itemIds?: number[],
    orgId?: number,
  ): Promise<OracleInventoryItem[]> {
    const queryParams: Record<string, unknown> = {};

    if (itemIds && itemIds.length > 0) {
      queryParams.itemIds = itemIds.join(',');
    }

    if (orgId !== undefined) {
      queryParams.organizationId = orgId;
    }

    const response = await this.client.get<Record<string, unknown>>(
      '/api/inventory/onHandQuantities',
      queryParams,
    );

    const { items } = extractInventoryItems(response);
    return items;
  }

  /**
   * Get inventory availability for a single item in a specific organization.
   * Oracle Fusion Cloud REST API: GET /api/inventory/onHandQuantities/{itemId}
   *
   * Returns detailed on-hand, reserved, and available quantities.
   */
  async getItemAvailability(itemId: number, orgId: number): Promise<OracleInventoryItem> {
    const response = await this.client.get<Record<string, unknown>>(
      `/api/inventory/onHandQuantities/${itemId}`,
      { organizationId: orgId },
    );

    const item = (response.item as OracleInventoryItem) ||
      (response.inventoryItem as OracleInventoryItem) ||
      (response as unknown as OracleInventoryItem);

    return item as OracleInventoryItem;
  }

  // -------------------------------------------------------------------------
  // Paginated listing
  // -------------------------------------------------------------------------

  /**
   * Fetch a page of inventory items with Oracle-style offset pagination.
   *
   * Oracle Fusion Cloud REST API supports `limit` and `offset` parameters.
   */
  async listInventoryPaginated(
    limit: number = 100,
    offset: number = 0,
  ): Promise<InventoryListResult> {
    const response = await this.client.get<Record<string, unknown>>(
      '/api/inventory/onHandQuantities',
      { limit, offset },
    );

    const { items, total } = extractInventoryItems(response);

    return {
      items,
      total,
      hasMore: offset + items.length < total,
    };
  }
}

export default OracleInventoryService;
