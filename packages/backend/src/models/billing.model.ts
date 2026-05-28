import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';

/**
 * Billing subscription record stored in the database.
 * Tracks Shopify Billing API subscription status per store.
 */
export interface BillingSubscription {
  id: string;
  storeId: string;
  shopifySubscriptionId: string;
  planName: string;
  planInterval: string;
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Row shape returned by the database.
 */
interface BillingSubscriptionRow {
  id: string;
  store_id: string;
  shopify_subscription_id: string;
  plan_name: string;
  plan_interval: string;
  status: string;
  trial_ends_at: string | null;
  current_period_ends_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToBillingSubscription(
  row: BillingSubscriptionRow,
): BillingSubscription {
  return {
    id: row.id,
    storeId: row.store_id,
    shopifySubscriptionId: row.shopify_subscription_id,
    planName: row.plan_name,
    planInterval: row.plan_interval,
    status: row.status,
    trialEndsAt: row.trial_ends_at ? new Date(row.trial_ends_at) : null,
    currentPeriodEndsAt: row.current_period_ends_at
      ? new Date(row.current_period_ends_at)
      : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export interface CreateBillingSubscriptionInput {
  storeId: string;
  shopifySubscriptionId: string;
  planName: string;
  planInterval: string;
  status: string;
  trialEndsAt?: Date | null;
  currentPeriodEndsAt?: Date | null;
}

export const BillingModel = {
  /**
   * Create a new billing subscription record.
   */
  async create(
    input: CreateBillingSubscriptionInput,
  ): Promise<BillingSubscription> {
    const id = uuidv4();
    const now = new Date().toISOString();

    const result = await query<BillingSubscriptionRow>(
      `INSERT INTO billing_subscriptions
       (id, store_id, shopify_subscription_id, plan_name, plan_interval, status, trial_ends_at, current_period_ends_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       RETURNING *`,
      [
        id,
        input.storeId,
        input.shopifySubscriptionId,
        input.planName,
        input.planInterval,
        input.status,
        input.trialEndsAt ? input.trialEndsAt.toISOString() : null,
        input.currentPeriodEndsAt
          ? input.currentPeriodEndsAt.toISOString()
          : null,
        now,
      ],
    );

    return rowToBillingSubscription(result.rows[0]);
  },

  /**
   * Find a billing subscription by store ID.
   */
  async findByStoreId(
    storeId: string,
  ): Promise<BillingSubscription | null> {
    const result = await query<BillingSubscriptionRow>(
      'SELECT * FROM billing_subscriptions WHERE store_id = $1',
      [storeId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return rowToBillingSubscription(result.rows[0]);
  },

  /**
   * Update the status of a billing subscription.
   */
  async updateStatus(storeId: string, status: string): Promise<void> {
    const now = new Date().toISOString();
    await query(
      'UPDATE billing_subscriptions SET status = $1, updated_at = $2 WHERE store_id = $3',
      [status, now, storeId],
    );
  },

  /**
   * Cancel a billing subscription.
   */
  async cancel(storeId: string): Promise<void> {
    const now = new Date().toISOString();
    await query(
      `UPDATE billing_subscriptions
       SET status = 'CANCELLED', updated_at = $1
       WHERE store_id = $2`,
      [now, storeId],
    );
  },
};

export default BillingModel;
