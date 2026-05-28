import { OracleClient, OracleClientError } from './oracle-client';
import { logger } from '../../utils/logger';
import type { OracleItem } from '@shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GetItemsParams {
  limit?: number;
  offset?: number;
  q?: string;
  organizationId?: number;
  itemStatus?: string;
  itemType?: string;
  itemNumber?: string;
  lastUpdateDate?: string;
  expand?: string;
  fields?: string;
}

export interface ItemListResult {
  items: OracleItem[];
  total: number;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract Oracle items from a paginated API response.
 * Oracle Fusion REST typically returns items inside an `items` array
 * with a `count` or `totalResults` field for pagination metadata.
 */
function extractItems(response: unknown): { items: OracleItem[]; total: number } {
  const body = response as Record<string, unknown>;

  const items = (body.items as OracleItem[]) || [];
  const total =
    (body.totalResults as number) ??
    (body.count as number) ??
    (body.total as number) ??
    items.length;

  return { items, total };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class OracleItemService {
  constructor(private readonly client: OracleClient) {}

  // -------------------------------------------------------------------------
  // Items
  // -------------------------------------------------------------------------

  /**
   * Get items with optional filtering.
   * Oracle Fusion Cloud REST API: GET /api/items
   */
  async getItems(params: GetItemsParams = {}): Promise<OracleItem[]> {
    const queryParams: Record<string, unknown> = {};

    if (params.limit) queryParams.limit = params.limit;
    if (params.offset) queryParams.offset = params.offset;
    if (params.q) queryParams.q = params.q;
    if (params.organizationId) queryParams.organizationId = params.organizationId;
    if (params.itemStatus) queryParams.itemStatus = params.itemStatus;
    if (params.itemType) queryParams.itemType = params.itemType;
    if (params.itemNumber) queryParams.itemNumber = params.itemNumber;
    if (params.lastUpdateDate) queryParams.lastUpdateDate = params.lastUpdateDate;
    if (params.expand) queryParams.expand = params.expand;
    if (params.fields) queryParams.fields = params.fields;

    const response = await this.client.get<Record<string, unknown>>(
      '/api/items',
      queryParams,
    );

    const { items } = extractItems(response);
    return items;
  }

  /**
   * Get a single item by its internal ID.
   * Oracle Fusion Cloud REST API: GET /api/items/{itemId}
   */
  async getItem(itemId: number): Promise<OracleItem> {
    const response = await this.client.get<Record<string, unknown>>(
      `/api/items/${itemId}`,
    );

    // The response may wrap the item in a top-level key or return it directly
    const item = (response.item as OracleItem) || (response as unknown as OracleItem);
    return item as OracleItem;
  }

  /**
   * Get an item by its item number (SKU).
   * Uses the Oracle REST API query parameter to search by ItemNumber.
   * Returns null if no item matches.
   */
  async getItemByNumber(itemNumber: string): Promise<OracleItem | null> {
    logger.debug('Looking up Oracle item by number', { itemNumber });

    const response = await this.client.get<Record<string, unknown>>('/api/items', {
      q: `ItemNumber eq '${itemNumber}'`,
      limit: 1,
    });

    const { items } = extractItems(response);

    if (items.length === 0) {
      return null;
    }

    return items[0];
  }

  /**
   * Create a new item in Oracle Fusion Cloud.
   * Oracle Fusion Cloud REST API: POST /api/items
   */
  async createItem(item: Partial<OracleItem>): Promise<OracleItem> {
    logger.info('Creating Oracle item', {
      itemNumber: item.ItemNumber,
      description: item.ItemDescription,
    });

    const response = await this.client.post<Record<string, unknown>>(
      '/api/items',
      item,
    );

    const created = (response.item as OracleItem) || (response as unknown as OracleItem);
    return created as OracleItem;
  }

  /**
   * Update an existing item in Oracle Fusion Cloud.
   * Oracle Fusion Cloud REST API: PATCH /api/items/{itemId}
   * Uses PATCH for partial updates.
   */
  async updateItem(itemId: number, item: Partial<OracleItem>): Promise<OracleItem> {
    logger.info('Updating Oracle item', { itemId });

    const response = await this.client.patch<Record<string, unknown>>(
      `/api/items/${itemId}`,
      item,
    );

    const updated = (response.item as OracleItem) || (response as unknown as OracleItem);
    return updated as OracleItem;
  }

  // -------------------------------------------------------------------------
  // Paginated listing
  // -------------------------------------------------------------------------

  /**
   * Fetch a page of items with Oracle-style offset pagination.
   *
   * Oracle Fusion Cloud REST API supports `limit` and `offset` parameters
   * for pagination, and returns `totalResults` or `count` for the total.
   */
  async listItemsPaginated(
    limit: number = 100,
    offset: number = 0,
  ): Promise<ItemListResult> {
    const response = await this.client.get<Record<string, unknown>>('/api/items', {
      limit,
      offset,
    });

    const { items, total } = extractItems(response);

    return {
      items,
      total,
      hasMore: offset + items.length < total,
    };
  }
}

export default OracleItemService;
