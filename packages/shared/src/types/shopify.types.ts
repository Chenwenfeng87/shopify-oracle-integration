export interface ShopifyProduct {
  id: number;
  title: string;
  body_html: string;
  vendor: string;
  product_type: string;
  handle: string;
  status: 'active' | 'archived' | 'draft';
  published_scope: 'global' | 'web';
  tags: string;
  variants: ShopifyVariant[];
  images: ShopifyImage[];
  options: ShopifyOption[];
  metafields?: ShopifyMetafield[];
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface ShopifyVariant {
  id: number;
  product_id: number;
  title: string;
  sku: string;
  barcode: string;
  price: string;
  compare_at_price: string | null;
  inventory_quantity: number;
  inventory_item_id: number;
  weight: number;
  weight_unit: 'kg' | 'g' | 'lb' | 'oz';
  requires_shipping: boolean;
  taxable: boolean;
  fulfillment_service: string;
  grams: number;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShopifyImage {
  id: number;
  product_id: number;
  position: number;
  src: string;
  alt: string | null;
  width: number;
  height: number;
  created_at: string;
  updated_at: string;
}

export interface ShopifyOption {
  id: number;
  product_id: number;
  name: string;
  position: number;
  values: string[];
}

export interface ShopifyCustomer {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  verified_email: boolean;
  currency: string;
  tax_exempt: boolean;
  tags: string;
  note: string | null;
  addresses: ShopifyAddress[];
  default_address: ShopifyAddress | null;
  created_at: string;
  updated_at: string;
}

export interface ShopifyAddress {
  id: number;
  customer_id: number;
  first_name: string;
  last_name: string;
  company: string | null;
  address1: string;
  address2: string | null;
  city: string;
  province: string;
  country: string;
  zip: string;
  phone: string | null;
  name: string;
  country_code: string;
  province_code: string | null;
  default: boolean;
}

export interface ShopifyOrder {
  id: number;
  email: string;
  order_number: number;
  name: string;
  note: string | null;
  financial_status: string;
  fulfillment_status: string | null;
  total_price: string;
  subtotal_price: string;
  total_tax: string;
  total_discounts: string;
  total_shipping_price_set: {
    shop_money: { amount: string; currency_code: string };
  };
  currency: string;
  line_items: ShopifyLineItem[];
  shipping_address: ShopifyAddress | null;
  billing_address: ShopifyAddress | null;
  customer: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
  };
  discount_codes: Array<{ code: string; amount: string; type: string }>;
  created_at: string;
  updated_at: string;
  processed_at: string;
  cancelled_at: string | null;
}

export interface ShopifyLineItem {
  id: number;
  variant_id: number;
  title: string;
  quantity: number;
  sku: string;
  price: string;
  total_discount: string;
  tax_lines: Array<{
    price: string;
    rate: number;
    title: string;
  }>;
  properties: Array<{ name: string; value: string }>;
}

export interface ShopifyInventoryLevel {
  inventory_item_id: number;
  location_id: number;
  available: number;
  updated_at: string;
}

export interface ShopifyInventoryItem {
  id: number;
  sku: string;
  tracked: boolean;
  cost: string | null;
  country_code_of_origin: string | null;
}

export interface ShopifyPriceRule {
  id: number;
  title: string;
  target_type: string;
  target_selection: string;
  allocation_method: string;
  value_type: string;
  value: string;
  starts_at: string;
  ends_at: string | null;
  status: 'active' | 'expired' | 'scheduled';
}

export interface ShopifyWebhook {
  id: number;
  address: string;
  topic: string;
  format: 'json' | 'xml';
  created_at: string;
  updated_at: string;
}

export interface ShopifyMetafield {
  id: number;
  namespace: string;
  key: string;
  value: string | number;
  type: string;
}

export type ShopifyWebhookTopic =
  | 'products/create'
  | 'products/update'
  | 'products/delete'
  | 'customers/create'
  | 'customers/update'
  | 'customers/delete'
  | 'orders/create'
  | 'orders/updated'
  | 'orders/cancelled'
  | 'orders/fulfilled'
  | 'inventory_levels/update'
  | 'app/uninstalled';
