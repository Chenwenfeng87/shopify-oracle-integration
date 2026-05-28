export interface OracleItem {
  ItemId: number;
  ItemNumber: string;
  ItemDescription: string;
  ItemType: string;
  PrimaryUOMCode: string;
  OrganizationId: number;
  LongDescription?: string;
  ItemStatus: string;
  ApprovedFlag: boolean;
  PurchasableFlag: boolean;
  SellableFlag: boolean;
  InventoryTrackedFlag: boolean;
  PrimaryCategoryId?: number;
  PrimaryCategoryName?: string;
  WeightValue?: number;
  WeightUOMCode?: string;
  ListPrice?: number;
  CurrencyCode?: string;
  CreatedBy: string;
  CreationDate: string;
  LastUpdateDate: string;
  LastUpdatedBy: string;
  AdditionalAttributes?: Record<string, unknown>;
}

export interface OracleCustomer {
  PartyId: number;
  PartyNumber: string;
  PartyName: string;
  PartyType: string;
  Status: string;
  EmailAddress?: string;
  PhoneNumber?: string;
  PrimaryAddressId?: number;
  Addresses: OracleAddress[];
  CreatedBy: string;
  CreationDate: string;
  LastUpdateDate: string;
  LastUpdatedBy: string;
}

export interface OracleAddress {
  AddressId: number;
  AddressNumber?: string;
  AddressLine1: string;
  AddressLine2?: string;
  City: string;
  State?: string;
  County?: string;
  Country: string;
  PostalCode?: string;
  AddressType: 'BILL_TO' | 'SHIP_TO' | 'HOME' | 'BUSINESS';
  PrimaryFlag: boolean;
  PhoneNumber?: string;
  EmailAddress?: string;
  CreatedBy: string;
  CreationDate: string;
  LastUpdateDate: string;
}

export interface OraclePrice {
  PriceId: number;
  ItemId: number;
  ItemNumber: string;
  PriceListId: number;
  PriceListName: string;
  PriceType: 'SALE' | 'PURCHASE' | 'TRANSFER';
  UnitPrice: number;
  CurrencyCode: string;
  EffectiveStartDate: string;
  EffectiveEndDate?: string;
  UOMCode: string;
  MinimumQuantity?: number;
  MaximumQuantity?: number;
  ActiveFlag: boolean;
  CreatedBy: string;
  CreationDate: string;
  LastUpdateDate: string;
}

export interface OracleSalesOrder {
  OrderId: number;
  OrderNumber: string;
  CustomerId: number;
  CustomerName: string;
  OrderType: string;
  Status: string;
  TransactionalCurrencyCode: string;
  TotalAmount: number;
  SubtotalAmount: number;
  TaxAmount: number;
  DiscountAmount?: number;
  ShippingAmount?: number;
  OrderDate: string;
  RequestedShipDate?: string;
  SourceSystem?: string;
  SourceOrderNumber?: string;
  BillToAddressId?: number;
  ShipToAddressId?: number;
  Lines: OracleOrderLine[];
  CreatedBy: string;
  CreationDate: string;
  LastUpdateDate: string;
}

export interface OracleOrderLine {
  LineId: number;
  OrderId: number;
  LineNumber: number;
  ItemId: number;
  ItemNumber: string;
  ItemDescription: string;
  Quantity: number;
  UOMCode: string;
  UnitPrice: number;
  LineTotal: number;
  TaxAmount?: number;
  DiscountAmount?: number;
  Status: string;
  FulfillmentStatus?: string;
  CreatedBy: string;
  CreationDate: string;
}

export interface OracleInventoryItem {
  ItemId: number;
  ItemNumber: string;
  OrganizationId: number;
  OrganizationCode: string;
  SubinventoryCode?: string;
  LocatorId?: number;
  OnHandQuantity: number;
  ReservedQuantity: number;
  AvailableQuantity: number;
  UOMCode: string;
  LastTransactionDate?: string;
  LastUpdateDate: string;
}

export interface OracleBatchRequest {
  items: Array<Record<string, unknown>>;
  batchSize: number;
  operation: 'CREATE' | 'UPDATE' | 'DELETE' | 'UPSERT';
}

export interface OracleBatchResponse {
  requestId: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILURE';
  totalRecords: number;
  processedRecords: number;
  failedRecords: number;
  errors: OracleBatchError[];
}

export interface OracleBatchError {
  index: number;
  record: Record<string, unknown>;
  errorCode: string;
  errorMessage: string;
}
