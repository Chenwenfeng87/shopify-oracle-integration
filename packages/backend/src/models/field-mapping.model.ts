import { v4 as uuidv4 } from 'uuid';
import { query, transaction } from '../config/database';
import type { EntityType, SyncDirection, FieldMapping, TransformRule } from '@shared/types';

/**
 * Row shape returned by the database.
 */
interface FieldMappingRow {
  id: string;
  store_id: string;
  entity_type: EntityType;
  direction: SyncDirection;
  shopify_field: string;
  oracle_field: string;
  transform_rule: Record<string, unknown> | null;
  is_required: boolean;
  created_at: string;
  updated_at: string;
}

function rowToFieldMapping(row: FieldMappingRow): FieldMapping {
  return {
    id: row.id,
    storeId: row.store_id,
    entityType: row.entity_type,
    direction: row.direction,
    shopifyField: row.shopify_field,
    oracleField: row.oracle_field,
    transformRule: row.transform_rule as TransformRule | null,
    isRequired: row.is_required,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export interface CreateFieldMappingInput {
  storeId: string;
  entityType: EntityType;
  direction: SyncDirection;
  shopifyField: string;
  oracleField: string;
  transformRule?: TransformRule | null;
  isRequired?: boolean;
}

export interface UpdateFieldMappingInput {
  shopifyField?: string;
  oracleField?: string;
  transformRule?: TransformRule | null;
  isRequired?: boolean;
}

// ──────────────────────────────────────────────
// Default Field Mapping Definitions
// ──────────────────────────────────────────────

export interface DefaultFieldMapping {
  shopifyField: string;
  oracleField: string;
  transformRule: TransformRule | null;
  isRequired: boolean;
}

/**
 * Default field mappings for Items (Shopify Product/Variant -> Oracle Item).
 */
export const DEFAULT_ITEM_MAPPINGS: DefaultFieldMapping[] = [
  { shopifyField: 'title', oracleField: 'ItemDescription', transformRule: null, isRequired: true },
  { shopifyField: 'sku', oracleField: 'ItemNumber', transformRule: null, isRequired: true },
  { shopifyField: 'body_html', oracleField: 'LongDescription', transformRule: null, isRequired: false },
  { shopifyField: 'product_type', oracleField: 'ItemType', transformRule: null, isRequired: false },
  { shopifyField: 'vendor', oracleField: 'AdditionalAttributes.Manufacturer', transformRule: null, isRequired: false },
  { shopifyField: 'weight', oracleField: 'WeightValue', transformRule: null, isRequired: false },
  { shopifyField: 'weight_unit', oracleField: 'WeightUOMCode', transformRule: { type: 'lookup', config: { map: { kg: 'KG', g: 'GM', lb: 'LB', oz: 'OZ' } } }, isRequired: false },
  { shopifyField: 'price', oracleField: 'ListPrice', transformRule: null, isRequired: false },
  { shopifyField: 'currency', oracleField: 'CurrencyCode', transformRule: null, isRequired: false },
  { shopifyField: 'status', oracleField: 'ItemStatus', transformRule: { type: 'lookup', config: { map: { active: 'Active', archived: 'Inactive', draft: 'Draft' } } }, isRequired: false },
  { shopifyField: 'inventory_quantity', oracleField: 'AdditionalAttributes.StockLevel', transformRule: null, isRequired: false },
  { shopifyField: 'barcode', oracleField: 'AdditionalAttributes.UPCCode', transformRule: null, isRequired: false },
  { shopifyField: 'tags', oracleField: 'AdditionalAttributes.Tags', transformRule: null, isRequired: false },
];

/**
 * Default field mappings for Customers (Shopify Customer -> Oracle Customer).
 */
export const DEFAULT_CUSTOMER_MAPPINGS: DefaultFieldMapping[] = [
  { shopifyField: 'email', oracleField: 'EmailAddress', transformRule: null, isRequired: true },
  { shopifyField: 'first_name', oracleField: 'PartyName', transformRule: { type: 'concat', config: { fields: ['first_name', 'last_name'], separator: ' ' } }, isRequired: true },
  { shopifyField: 'last_name', oracleField: 'PartyName', transformRule: { type: 'concat', config: { fields: ['first_name', 'last_name'], separator: ' ' } }, isRequired: true },
  { shopifyField: 'phone', oracleField: 'PhoneNumber', transformRule: null, isRequired: false },
  { shopifyField: 'currency', oracleField: 'AdditionalAttributes.Currency', transformRule: null, isRequired: false },
  { shopifyField: 'tax_exempt', oracleField: 'AdditionalAttributes.TaxExempt', transformRule: null, isRequired: false },
  { shopifyField: 'addresses[0].address1', oracleField: 'Addresses[0].AddressLine1', transformRule: null, isRequired: false },
  { shopifyField: 'addresses[0].address2', oracleField: 'Addresses[0].AddressLine2', transformRule: null, isRequired: false },
  { shopifyField: 'addresses[0].city', oracleField: 'Addresses[0].City', transformRule: null, isRequired: false },
  { shopifyField: 'addresses[0].province', oracleField: 'Addresses[0].State', transformRule: null, isRequired: false },
  { shopifyField: 'addresses[0].country', oracleField: 'Addresses[0].Country', transformRule: null, isRequired: false },
  { shopifyField: 'addresses[0].zip', oracleField: 'Addresses[0].PostalCode', transformRule: null, isRequired: false },
];

/**
 * Default field mappings for Orders (Shopify Order -> Oracle Sales Order).
 */
export const DEFAULT_ORDER_MAPPINGS: DefaultFieldMapping[] = [
  { shopifyField: 'name', oracleField: 'SourceOrderNumber', transformRule: null, isRequired: true },
  { shopifyField: 'order_number', oracleField: 'AdditionalAttributes.OrderNumber', transformRule: null, isRequired: false },
  { shopifyField: 'currency', oracleField: 'TransactionalCurrencyCode', transformRule: null, isRequired: true },
  { shopifyField: 'total_price', oracleField: 'TotalAmount', transformRule: null, isRequired: true },
  { shopifyField: 'subtotal_price', oracleField: 'SubtotalAmount', transformRule: null, isRequired: false },
  { shopifyField: 'total_tax', oracleField: 'TaxAmount', transformRule: null, isRequired: false },
  { shopifyField: 'total_discounts', oracleField: 'DiscountAmount', transformRule: null, isRequired: false },
  { shopifyField: 'shipping_price', oracleField: 'ShippingAmount', transformRule: null, isRequired: false },
  { shopifyField: 'created_at', oracleField: 'OrderDate', transformRule: { type: 'date_format', config: { inputFormat: 'ISO', outputFormat: 'YYYY-MM-DD' } }, isRequired: false },
  { shopifyField: 'customer.email', oracleField: 'AdditionalAttributes.CustomerEmail', transformRule: null, isRequired: false },
  { shopifyField: 'financial_status', oracleField: 'Status', transformRule: { type: 'lookup', config: { map: { paid: 'BOOKED', pending: 'ENTERED', refunded: 'CANCELLED', partially_refunded: 'PARTIALLY_REFUNDED', voided: 'CANCELLED' } } }, isRequired: false },
  { shopifyField: 'line_items[].sku', oracleField: 'Lines[].ItemNumber', transformRule: null, isRequired: false },
  { shopifyField: 'line_items[].quantity', oracleField: 'Lines[].Quantity', transformRule: null, isRequired: false },
  { shopifyField: 'line_items[].price', oracleField: 'Lines[].UnitPrice', transformRule: null, isRequired: false },
  { shopifyField: 'line_items[].title', oracleField: 'Lines[].ItemDescription', transformRule: null, isRequired: false },
];

/**
 * Default field mappings for Prices (Oracle Price -> Shopify Price Rule).
 */
export const DEFAULT_PRICE_MAPPINGS: DefaultFieldMapping[] = [
  { shopifyField: 'price', oracleField: 'UnitPrice', transformRule: null, isRequired: true },
  { shopifyField: 'compare_at_price', oracleField: 'ListPrice', transformRule: null, isRequired: false },
  { shopifyField: 'sku', oracleField: 'ItemNumber', transformRule: null, isRequired: true },
  { shopifyField: 'currency', oracleField: 'CurrencyCode', transformRule: null, isRequired: true },
  { shopifyField: 'title', oracleField: 'PriceListName', transformRule: null, isRequired: false },
];

/**
 * Default field mappings for Inventory (Oracle Inventory -> Shopify Inventory).
 */
export const DEFAULT_INVENTORY_MAPPINGS: DefaultFieldMapping[] = [
  { shopifyField: 'inventory_quantity', oracleField: 'OnHandQuantity', transformRule: null, isRequired: true },
  { shopifyField: 'sku', oracleField: 'ItemNumber', transformRule: null, isRequired: true },
  { shopifyField: 'inventory_item_id', oracleField: 'ItemId', transformRule: null, isRequired: false },
  { shopifyField: 'location_id', oracleField: 'OrganizationCode', transformRule: null, isRequired: false },
  { shopifyField: 'available', oracleField: 'AvailableQuantity', transformRule: null, isRequired: false },
];

/**
 * Map of entity type to default field mappings (Shopify -> Oracle direction).
 */
const DEFAULT_MAPPINGS_BY_ENTITY: Record<EntityType, DefaultFieldMapping[]> = {
  item: DEFAULT_ITEM_MAPPINGS,
  customer: DEFAULT_CUSTOMER_MAPPINGS,
  order: DEFAULT_ORDER_MAPPINGS,
  price: DEFAULT_PRICE_MAPPINGS,
  inventory: DEFAULT_INVENTORY_MAPPINGS,
};

// ──────────────────────────────────────────────
// Field Mapping Model
// ──────────────────────────────────────────────

export const FieldMappingModel = {
  /**
   * Create a single field mapping.
   */
  async create(input: CreateFieldMappingInput): Promise<FieldMapping> {
    const id = uuidv4();
    const now = new Date().toISOString();

    const result = await query<FieldMappingRow>(
      `INSERT INTO field_mappings
       (id, store_id, entity_type, direction, shopify_field, oracle_field, transform_rule, is_required, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       RETURNING *`,
      [
        id,
        input.storeId,
        input.entityType,
        input.direction,
        input.shopifyField,
        input.oracleField,
        input.transformRule ? JSON.stringify(input.transformRule) : null,
        input.isRequired ?? false,
        now,
      ],
    );

    return rowToFieldMapping(result.rows[0]);
  },

  /**
   * Find a field mapping by its ID.
   */
  async findById(id: string): Promise<FieldMapping | null> {
    const result = await query<FieldMappingRow>(
      'SELECT * FROM field_mappings WHERE id = $1',
      [id],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return rowToFieldMapping(result.rows[0]);
  },

  /**
   * Find all field mappings for a given store, entity type, and sync direction.
   */
  async findByStoreAndEntity(
    storeId: string,
    entityType: EntityType,
    direction: SyncDirection,
  ): Promise<FieldMapping[]> {
    const result = await query<FieldMappingRow>(
      'SELECT * FROM field_mappings WHERE store_id = $1 AND entity_type = $2 AND direction = $3 ORDER BY created_at ASC',
      [storeId, entityType, direction],
    );

    return result.rows.map(rowToFieldMapping);
  },

  /**
   * Update a field mapping.
   */
  async update(id: string, input: UpdateFieldMappingInput): Promise<FieldMapping> {
    const now = new Date().toISOString();
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (input.shopifyField !== undefined) {
      setClauses.push(`shopify_field = $${paramIndex++}`);
      params.push(input.shopifyField);
    }

    if (input.oracleField !== undefined) {
      setClauses.push(`oracle_field = $${paramIndex++}`);
      params.push(input.oracleField);
    }

    if (input.transformRule !== undefined) {
      setClauses.push(`transform_rule = $${paramIndex++}`);
      params.push(
        input.transformRule ? JSON.stringify(input.transformRule) : null,
      );
    }

    if (input.isRequired !== undefined) {
      setClauses.push(`is_required = $${paramIndex++}`);
      params.push(input.isRequired);
    }

    if (setClauses.length === 0) {
      const existing = await this.findById(id);
      if (!existing) {
        throw new Error(`Field mapping not found: ${id}`);
      }
      return existing;
    }

    setClauses.push(`updated_at = $${paramIndex++}`);
    params.push(now);

    params.push(id);
    const sql = `UPDATE field_mappings SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`;

    const result = await query<FieldMappingRow>(sql, params);

    if (result.rows.length === 0) {
      throw new Error(`Field mapping not found: ${id}`);
    }

    return rowToFieldMapping(result.rows[0]);
  },

  /**
   * Delete a single field mapping.
   */
  async delete(id: string): Promise<void> {
    await query('DELETE FROM field_mappings WHERE id = $1', [id]);
  },

  /**
   * Delete all field mappings for a store and entity type.
   * Useful when resetting mappings to defaults.
   */
  async deleteAll(storeId: string, entityType: EntityType): Promise<void> {
    await query(
      'DELETE FROM field_mappings WHERE store_id = $1 AND entity_type = $2',
      [storeId, entityType],
    );
  },

  /**
   * Bulk create field mappings within a transaction.
   */
  async bulkCreate(
    mappings: CreateFieldMappingInput[],
  ): Promise<FieldMapping[]> {
    if (mappings.length === 0) {
      return [];
    }

    return transaction(async (client) => {
      const results: FieldMapping[] = [];

      for (const mapping of mappings) {
        const id = uuidv4();
        const now = new Date().toISOString();
        const transformRuleStr = mapping.transformRule
          ? JSON.stringify(mapping.transformRule)
          : null;

        const result = await client.query<FieldMappingRow>(
          `INSERT INTO field_mappings
           (id, store_id, entity_type, direction, shopify_field, oracle_field, transform_rule, is_required, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
           RETURNING *`,
          [
            id,
            mapping.storeId,
            mapping.entityType,
            mapping.direction,
            mapping.shopifyField,
            mapping.oracleField,
            transformRuleStr,
            mapping.isRequired ?? false,
            now,
          ],
        );

        results.push(rowToFieldMapping(result.rows[0]));
      }

      return results;
    });
  },

  /**
   * Get the default field mappings for a given entity type.
   * These are the mappings that would be used for a new store if no
   * custom mappings have been configured.
   */
  async getDefaults(
    entityType: EntityType,
  ): Promise<DefaultFieldMapping[]> {
    return DEFAULT_MAPPINGS_BY_ENTITY[entityType] || [];
  },
};

export default FieldMappingModel;
