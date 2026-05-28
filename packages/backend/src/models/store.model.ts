import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';

/**
 * Store record as stored in the database.
 * Represents a Shopify store that has installed the integration app.
 */
export interface Store {
  id: string;
  shopifyDomain: string;
  shopifyToken: string | null;
  shopifyApiKey: string | null;
  isActive: boolean;
  installedAt: Date;
  uninstalledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Row shape returned by the database.
 */
interface StoreRow {
  id: string;
  shopify_domain: string;
  shopify_token: string | null;
  shopify_api_key: string | null;
  is_active: boolean;
  installed_at: string;
  uninstalled_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToStore(row: StoreRow): Store {
  return {
    id: row.id,
    shopifyDomain: row.shopify_domain,
    shopifyToken: row.shopify_token,
    shopifyApiKey: row.shopify_api_key,
    isActive: row.is_active,
    installedAt: new Date(row.installed_at),
    uninstalledAt: row.uninstalled_at ? new Date(row.uninstalled_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export interface CreateStoreInput {
  shopifyDomain: string;
  shopifyToken?: string;
  shopifyApiKey?: string;
}

export const StoreModel = {
  /**
   * Create a new store record.
   */
  async create(input: CreateStoreInput): Promise<Store> {
    const id = uuidv4();
    const now = new Date().toISOString();

    const result = await query<StoreRow>(
      `INSERT INTO stores (id, shopify_domain, shopify_token, shopify_api_key, is_active, installed_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, true, $5, $5, $5)
       RETURNING *`,
      [id, input.shopifyDomain, input.shopifyToken || null, input.shopifyApiKey || null, now],
    );

    return rowToStore(result.rows[0]);
  },

  /**
   * Find a store by its Shopify domain.
   */
  async findByDomain(domain: string): Promise<Store | null> {
    const result = await query<StoreRow>(
      'SELECT * FROM stores WHERE shopify_domain = $1',
      [domain],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return rowToStore(result.rows[0]);
  },

  /**
   * Find a store by its internal ID.
   */
  async findById(id: string): Promise<Store | null> {
    const result = await query<StoreRow>(
      'SELECT * FROM stores WHERE id = $1',
      [id],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return rowToStore(result.rows[0]);
  },

  /**
   * Update a store's Shopify access token.
   */
  async updateToken(id: string, token: string): Promise<void> {
    const now = new Date().toISOString();
    await query(
      'UPDATE stores SET shopify_token = $1, updated_at = $2 WHERE id = $3',
      [token, now, id],
    );
  },

  /**
   * Mark a store as inactive (e.g., on app uninstall).
   */
  async deactivate(id: string): Promise<void> {
    const now = new Date().toISOString();
    await query(
      'UPDATE stores SET is_active = false, uninstalled_at = $1, updated_at = $1 WHERE id = $2',
      [now, id],
    );
  },

  /**
   * Reactivate a previously deactivated store.
   */
  async reactivate(id: string): Promise<void> {
    const now = new Date().toISOString();
    await query(
      'UPDATE stores SET is_active = true, uninstalled_at = NULL, updated_at = $1 WHERE id = $2',
      [now, id],
    );
  },

  /**
   * List all stores.
   * Optionally filter by active status.
   */
  async list(activeOnly?: boolean): Promise<Store[]> {
    let sql = 'SELECT * FROM stores';
    const params: unknown[] = [];

    if (activeOnly === true) {
      sql += ' WHERE is_active = true';
    }

    sql += ' ORDER BY created_at DESC';

    const result = await query<StoreRow>(sql, params);
    return result.rows.map(rowToStore);
  },
};
