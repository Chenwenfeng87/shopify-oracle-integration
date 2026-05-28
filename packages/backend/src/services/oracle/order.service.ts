import { OracleClient } from './oracle-client';
import { logger } from '../../utils/logger';
import type { OracleSalesOrder, OracleOrderLine } from '@shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GetOrdersParams {
  limit?: number;
  offset?: number;
  q?: string;
  customerId?: number;
  status?: string;
  orderType?: string;
  sourceSystem?: string;
  sourceOrderNumber?: string;
  orderDateFrom?: string;
  orderDateTo?: string;
  lastUpdateDate?: string;
  expand?: string;
  fields?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractOrders(response: unknown): { orders: OracleSalesOrder[]; total: number } {
  const body = response as Record<string, unknown>;

  const orders = (body.items as OracleSalesOrder[]) ||
    (body.orders as OracleSalesOrder[]) ||
    [];

  const total =
    (body.totalResults as number) ??
    (body.count as number) ??
    orders.length;

  return { orders, total };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class OracleOrderService {
  constructor(private readonly client: OracleClient) {}

  // -------------------------------------------------------------------------
  // Orders
  // -------------------------------------------------------------------------

  /**
   * Get sales orders with optional filtering.
   * Oracle Fusion Cloud REST API: GET /api/orders
   */
  async getOrders(params: GetOrdersParams = {}): Promise<OracleSalesOrder[]> {
    const queryParams: Record<string, unknown> = {};

    if (params.limit) queryParams.limit = params.limit;
    if (params.offset) queryParams.offset = params.offset;
    if (params.q) queryParams.q = params.q;
    if (params.customerId) queryParams.customerId = params.customerId;
    if (params.status) queryParams.status = params.status;
    if (params.orderType) queryParams.orderType = params.orderType;
    if (params.sourceSystem) queryParams.sourceSystem = params.sourceSystem;
    if (params.sourceOrderNumber) queryParams.sourceOrderNumber = params.sourceOrderNumber;
    if (params.orderDateFrom) queryParams.orderDateFrom = params.orderDateFrom;
    if (params.orderDateTo) queryParams.orderDateTo = params.orderDateTo;
    if (params.lastUpdateDate) queryParams.lastUpdateDate = params.lastUpdateDate;
    if (params.expand) queryParams.expand = params.expand;
    if (params.fields) queryParams.fields = params.fields;

    const response = await this.client.get<Record<string, unknown>>(
      '/api/orders',
      queryParams,
    );

    const { orders } = extractOrders(response);
    return orders;
  }

  /**
   * Get a single sales order by its internal ID.
   * Oracle Fusion Cloud REST API: GET /api/orders/{orderId}
   */
  async getOrder(orderId: number): Promise<OracleSalesOrder> {
    const response = await this.client.get<Record<string, unknown>>(
      `/api/orders/${orderId}`,
    );

    const order = (response.order as OracleSalesOrder) ||
      (response.item as OracleSalesOrder) ||
      (response as unknown as OracleSalesOrder);

    return order as OracleSalesOrder;
  }

  /**
   * Find an order by its source order number.
   * In this integration, the source order number is typically the
   * Shopify order name (e.g. "#1001").
   *
   * Returns null if no matching order is found.
   */
  async getOrderBySourceNumber(sourceOrderNumber: string): Promise<OracleSalesOrder | null> {
    logger.debug('Looking up Oracle order by source number', { sourceOrderNumber });

    const response = await this.client.get<Record<string, unknown>>('/api/orders', {
      q: `SourceOrderNumber eq '${sourceOrderNumber}'`,
      limit: 1,
    });

    const { orders } = extractOrders(response);

    return orders.length > 0 ? orders[0] : null;
  }

  /**
   * Create a new sales order in Oracle Fusion Cloud.
   * Oracle Fusion Cloud REST API: POST /api/orders
   */
  async createOrder(order: Partial<OracleSalesOrder>): Promise<OracleSalesOrder> {
    logger.info('Creating Oracle sales order', {
      orderNumber: order.OrderNumber,
      customerId: order.CustomerId,
    });

    const response = await this.client.post<Record<string, unknown>>(
      '/api/orders',
      order,
    );

    const created = (response.order as OracleSalesOrder) ||
      (response.item as OracleSalesOrder) ||
      (response as unknown as OracleSalesOrder);

    return created as OracleSalesOrder;
  }

  /**
   * Update the status of an existing sales order.
   * Oracle Fusion Cloud REST API: PATCH /api/orders/{orderId}
   *
   * Common statuses: BOOKED, ENTERED, CANCELLED, CLOSED, PARTIALLY_SHIPPED, SHIPPED
   */
  async updateOrderStatus(orderId: number, status: string): Promise<OracleSalesOrder> {
    logger.info('Updating Oracle order status', { orderId, status });

    const response = await this.client.patch<Record<string, unknown>>(
      `/api/orders/${orderId}`,
      { Status: status },
    );

    const updated = (response.order as OracleSalesOrder) ||
      (response.item as OracleSalesOrder) ||
      (response as unknown as OracleSalesOrder);

    return updated as OracleSalesOrder;
  }

  /**
   * Add a line to an existing sales order.
   * Oracle Fusion Cloud REST API: POST /api/orders/{orderId}/lines
   */
  async addOrderLine(orderId: number, line: Partial<OracleOrderLine>): Promise<OracleOrderLine> {
    logger.info('Adding line to Oracle order', {
      orderId,
      itemNumber: line.ItemNumber,
      quantity: line.Quantity,
    });

    const response = await this.client.post<Record<string, unknown>>(
      `/api/orders/${orderId}/lines`,
      line,
    );

    const created = (response.line as OracleOrderLine) ||
      (response.item as OracleOrderLine) ||
      (response as unknown as OracleOrderLine);

    return created as OracleOrderLine;
  }
}

export default OracleOrderService;
