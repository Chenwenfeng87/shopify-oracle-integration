-- ============================================================================
-- Seed Default Field Mappings
-- ============================================================================
-- These mappings are inserted for every newly created store as sensible
-- defaults. The application copies them into the field_mappings table
-- when a store is provisioned, using a placeholder UUID that the app
-- replaces with the actual store_id at runtime.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Entity: Item (Product) — Oracle to Shopify direction
-- Maps Oracle inventory item fields to Shopify product fields.
-- ---------------------------------------------------------------------------
INSERT INTO field_mappings (store_id, entity_type, direction, shopify_field, oracle_field, transform_rule, is_required) VALUES
('00000000-0000-0000-0000-000000000000', 'item', 'oracle_to_shopify', 'sku', 'ItemNumber', NULL, TRUE),
('00000000-0000-0000-0000-000000000000', 'item', 'oracle_to_shopify', 'title', 'ItemDescription', NULL, TRUE),
('00000000-0000-0000-0000-000000000000', 'item', 'oracle_to_shopify', 'product_type', 'ItemType', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'item', 'oracle_to_shopify', 'body_html', 'ItemLongDescription', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'item', 'oracle_to_shopify', 'vendor', 'ManufacturerName', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'item', 'oracle_to_shopify', 'status', 'ItemStatus', jsonb_build_object('mapping', jsonb_build_object('Active', 'active', 'Inactive', 'draft')), FALSE),
('00000000-0000-0000-0000-000000000000', 'item', 'oracle_to_shopify', 'price', 'ListPrice', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'item', 'oracle_to_shopify', 'tags', 'CategoryName', jsonb_build_object('delimiter', ','), FALSE),
('00000000-0000-0000-0000-000000000000', 'item', 'oracle_to_shopify', 'option1_name', 'PrimaryUOMCode', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'item', 'oracle_to_shopify', 'weight', 'UnitWeight', jsonb_build_object('multiplier', 0.453592), FALSE);

-- ---------------------------------------------------------------------------
-- Entity: Item (Product) — Shopify to Oracle direction
-- Maps Shopify product fields back to Oracle inventory item fields.
-- ---------------------------------------------------------------------------
INSERT INTO field_mappings (store_id, entity_type, direction, shopify_field, oracle_field, transform_rule, is_required) VALUES
('00000000-0000-0000-0000-000000000000', 'item', 'shopify_to_oracle', 'sku', 'ItemNumber', NULL, TRUE),
('00000000-0000-0000-0000-000000000000', 'item', 'shopify_to_oracle', 'title', 'ItemDescription', NULL, TRUE),
('00000000-0000-0000-0000-000000000000', 'item', 'shopify_to_oracle', 'product_type', 'ItemType', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'item', 'shopify_to_oracle', 'body_html', 'ItemLongDescription', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'item', 'shopify_to_oracle', 'vendor', 'ManufacturerName', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'item', 'shopify_to_oracle', 'status', 'ItemStatus', jsonb_build_object('mapping', jsonb_build_object('active', 'Active', 'draft', 'Inactive')), FALSE),
('00000000-0000-0000-0000-000000000000', 'item', 'shopify_to_oracle', 'price', 'ListPrice', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'item', 'shopify_to_oracle', 'tags', 'CategoryName', jsonb_build_object('delimiter', ','), FALSE),
('00000000-0000-0000-0000-000000000000', 'item', 'shopify_to_oracle', 'inventory_quantity', 'QuantityOnHand', NULL, FALSE);

-- ---------------------------------------------------------------------------
-- Entity: Customer — Shopify to Oracle direction
-- Maps Shopify customer fields to Oracle ERP contact / customer fields.
-- ---------------------------------------------------------------------------
INSERT INTO field_mappings (store_id, entity_type, direction, shopify_field, oracle_field, transform_rule, is_required) VALUES
('00000000-0000-0000-0000-000000000000', 'customer', 'shopify_to_oracle', 'email', 'EmailAddress', NULL, TRUE),
('00000000-0000-0000-0000-000000000000', 'customer', 'shopify_to_oracle', 'first_name', 'FirstName', NULL, TRUE),
('00000000-0000-0000-0000-000000000000', 'customer', 'shopify_to_oracle', 'last_name', 'LastName', NULL, TRUE),
('00000000-0000-0000-0000-000000000000', 'customer', 'shopify_to_oracle', 'phone', 'PrimaryPhoneNumber', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'customer', 'shopify_to_oracle', 'note', 'Comments', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'customer', 'shopify_to_oracle', 'addresses[0].address1', 'AddressLine1', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'customer', 'shopify_to_oracle', 'addresses[0].city', 'City', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'customer', 'shopify_to_oracle', 'addresses[0].province', 'State', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'customer', 'shopify_to_oracle', 'addresses[0].zip', 'PostalCode', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'customer', 'shopify_to_oracle', 'addresses[0].country', 'Country', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'customer', 'shopify_to_oracle', 'tax_exempt', 'TaxExemptFlag', jsonb_build_object('mapping', jsonb_build_object('true', 'Y', 'false', 'N')), FALSE),
('00000000-0000-0000-0000-000000000000', 'customer', 'shopify_to_oracle', 'currency', 'CurrencyCode', NULL, FALSE);

-- ---------------------------------------------------------------------------
-- Entity: Customer — Oracle to Shopify direction
-- Maps Oracle ERP customer fields back to Shopify customer fields.
-- ---------------------------------------------------------------------------
INSERT INTO field_mappings (store_id, entity_type, direction, shopify_field, oracle_field, transform_rule, is_required) VALUES
('00000000-0000-0000-0000-000000000000', 'customer', 'oracle_to_shopify', 'email', 'EmailAddress', NULL, TRUE),
('00000000-0000-0000-0000-000000000000', 'customer', 'oracle_to_shopify', 'first_name', 'FirstName', NULL, TRUE),
('00000000-0000-0000-0000-000000000000', 'customer', 'oracle_to_shopify', 'last_name', 'LastName', NULL, TRUE),
('00000000-0000-0000-0000-000000000000', 'customer', 'oracle_to_shopify', 'phone', 'PrimaryPhoneNumber', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'customer', 'oracle_to_shopify', 'note', 'Comments', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'customer', 'oracle_to_shopify', 'addresses[0].address1', 'AddressLine1', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'customer', 'oracle_to_shopify', 'addresses[0].city', 'City', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'customer', 'oracle_to_shopify', 'addresses[0].province', 'State', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'customer', 'oracle_to_shopify', 'addresses[0].zip', 'PostalCode', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'customer', 'oracle_to_shopify', 'addresses[0].country', 'Country', NULL, FALSE);

-- ---------------------------------------------------------------------------
-- Entity: Order — Shopify to Oracle direction
-- Maps Shopify order fields to Oracle Order Management fields.
-- ---------------------------------------------------------------------------
INSERT INTO field_mappings (store_id, entity_type, direction, shopify_field, oracle_field, transform_rule, is_required) VALUES
('00000000-0000-0000-0000-000000000000', 'order', 'shopify_to_oracle', 'order_number', 'OrderNumber', NULL, TRUE),
('00000000-0000-0000-0000-000000000000', 'order', 'shopify_to_oracle', 'created_at', 'OrderDate', NULL, TRUE),
('00000000-0000-0000-0000-000000000000', 'order', 'shopify_to_oracle', 'currency', 'CurrencyCode', NULL, TRUE),
('00000000-0000-0000-0000-000000000000', 'order', 'shopify_to_oracle', 'total_price', 'TotalAmount', NULL, TRUE),
('00000000-0000-0000-0000-000000000000', 'order', 'shopify_to_oracle', 'subtotal_price', 'SubTotal', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'order', 'shopify_to_oracle', 'total_tax', 'TaxAmount', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'order', 'shopify_to_oracle', 'shipping_lines[0].price', 'ShippingAmount', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'order', 'shopify_to_oracle', 'financial_status', 'PaymentStatus', jsonb_build_object('mapping', jsonb_build_object('paid', 'Paid', 'pending', 'Pending', 'refunded', 'Refunded', 'voided', 'Cancelled')), FALSE),
('00000000-0000-0000-0000-000000000000', 'order', 'shopify_to_oracle', 'fulfillment_status', 'FulfillmentStatus', jsonb_build_object('mapping', jsonb_build_object('fulfilled', 'Fulfilled', 'partial', 'PartiallyFulfilled', 'unfulfilled', 'NotFulfilled')), FALSE),
('00000000-0000-0000-0000-000000000000', 'order', 'shopify_to_oracle', 'note', 'Comments', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'order', 'shopify_to_oracle', 'shipping_address.address1', 'ShipToAddressLine1', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'order', 'shopify_to_oracle', 'shipping_address.city', 'ShipToCity', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'order', 'shopify_to_oracle', 'shipping_address.province', 'ShipToState', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'order', 'shopify_to_oracle', 'shipping_address.zip', 'ShipToPostalCode', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'order', 'shopify_to_oracle', 'shipping_address.country', 'ShipToCountry', NULL, FALSE);

-- ---------------------------------------------------------------------------
-- Entity: Order — Oracle to Shopify direction
-- Maps Oracle order fields back to Shopify.
-- ---------------------------------------------------------------------------
INSERT INTO field_mappings (store_id, entity_type, direction, shopify_field, oracle_field, transform_rule, is_required) VALUES
('00000000-0000-0000-0000-000000000000', 'order', 'oracle_to_shopify', 'order_number', 'OrderNumber', NULL, TRUE),
('00000000-0000-0000-0000-000000000000', 'order', 'oracle_to_shopify', 'created_at', 'OrderDate', NULL, TRUE),
('00000000-0000-0000-0000-000000000000', 'order', 'oracle_to_shopify', 'currency', 'CurrencyCode', NULL, TRUE),
('00000000-0000-0000-0000-000000000000', 'order', 'oracle_to_shopify', 'total_price', 'TotalAmount', NULL, TRUE),
('00000000-0000-0000-0000-000000000000', 'order', 'oracle_to_shopify', 'financial_status', 'PaymentStatus', jsonb_build_object('mapping', jsonb_build_object('Paid', 'paid', 'Pending', 'pending', 'Refunded', 'refunded')), FALSE);

-- ---------------------------------------------------------------------------
-- Entity: Price — Shopify to Oracle direction
-- Maps product pricing data from Shopify to Oracle.
-- ---------------------------------------------------------------------------
INSERT INTO field_mappings (store_id, entity_type, direction, shopify_field, oracle_field, transform_rule, is_required) VALUES
('00000000-0000-0000-0000-000000000000', 'price', 'shopify_to_oracle', 'sku', 'ItemNumber', NULL, TRUE),
('00000000-0000-0000-0000-000000000000', 'price', 'shopify_to_oracle', 'price', 'UnitPrice', NULL, TRUE),
('00000000-0000-0000-0000-000000000000', 'price', 'shopify_to_oracle', 'compare_at_price', 'ListPrice', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'price', 'shopify_to_oracle', 'currency', 'CurrencyCode', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'price', 'shopify_to_oracle', 'variant_id', 'ItemIdentifier', NULL, FALSE);

-- ---------------------------------------------------------------------------
-- Entity: Price — Oracle to Shopify direction
-- Maps Oracle pricing data back to Shopify.
-- ---------------------------------------------------------------------------
INSERT INTO field_mappings (store_id, entity_type, direction, shopify_field, oracle_field, transform_rule, is_required) VALUES
('00000000-0000-0000-0000-000000000000', 'price', 'oracle_to_shopify', 'sku', 'ItemNumber', NULL, TRUE),
('00000000-0000-0000-0000-000000000000', 'price', 'oracle_to_shopify', 'price', 'UnitPrice', NULL, TRUE),
('00000000-0000-0000-0000-000000000000', 'price', 'oracle_to_shopify', 'compare_at_price', 'ListPrice', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'price', 'oracle_to_shopify', 'currency', 'CurrencyCode', NULL, FALSE);

-- ---------------------------------------------------------------------------
-- Entity: Inventory — Oracle to Shopify direction
-- Maps Oracle inventory levels to Shopify inventory quantities.
-- ---------------------------------------------------------------------------
INSERT INTO field_mappings (store_id, entity_type, direction, shopify_field, oracle_field, transform_rule, is_required) VALUES
('00000000-0000-0000-0000-000000000000', 'inventory', 'oracle_to_shopify', 'sku', 'ItemNumber', NULL, TRUE),
('00000000-0000-0000-0000-000000000000', 'inventory', 'oracle_to_shopify', 'inventory_quantity', 'QuantityOnHand', NULL, TRUE),
('00000000-0000-0000-0000-000000000000', 'inventory', 'oracle_to_shopify', 'inventory_quantity', 'AvailableQuantity', NULL, FALSE),
('00000000-0000-0000-0000-000000000000', 'inventory', 'oracle_to_shopify', 'location_id', 'WarehouseCode', NULL, FALSE);

-- ---------------------------------------------------------------------------
-- Entity: Inventory — Shopify to Oracle direction
-- Maps Shopify inventory changes back to Oracle.
-- ---------------------------------------------------------------------------
INSERT INTO field_mappings (store_id, entity_type, direction, shopify_field, oracle_field, transform_rule, is_required) VALUES
('00000000-0000-0000-0000-000000000000', 'inventory', 'shopify_to_oracle', 'sku', 'ItemNumber', NULL, TRUE),
('00000000-0000-0000-0000-000000000000', 'inventory', 'shopify_to_oracle', 'inventory_quantity', 'QuantityOnHand', NULL, TRUE),
('00000000-0000-0000-0000-000000000000', 'inventory', 'shopify_to_oracle', 'location_id', 'WarehouseCode', NULL, FALSE);
