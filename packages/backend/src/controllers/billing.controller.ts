import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { BillingModel } from '../models/billing.model';
import { StoreModel } from '../models/store.model';
import { config } from '../config/app.config';
import { logger } from '../utils/logger';

/**
 * Handles all billing-related HTTP requests:
 *
 * - GET  /api/billing           — Get current subscription
 * - POST /api/billing/create    — Create a Shopify billing charge
 * - POST /api/billing/callback  — Handle Shopify billing callback
 * - POST /api/billing/cancel    — Cancel subscription
 */
export class BillingController {
  /**
   * GET /api/billing
   *
   * Get the current billing subscription for a store.
   * Returns null-ish { configured: false } if no subscription exists.
   */
  async getSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const schema = z.object({
        storeId: z.string().uuid(),
      });

      const validated = schema.parse(req.query);
      const { storeId } = validated;

      const subscription = await BillingModel.findByStoreId(storeId);

      res.json({
        success: true,
        data: subscription || { configured: false },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }
      next(error);
    }
  }

  /**
   * POST /api/billing/create
   *
   * Create a new billing charge via Shopify's Billing API.
   * Returns the charge payload and confirmation URL that the merchant
   * must visit to approve the charge.
   */
  async createCharge(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const schema = z.object({
        storeId: z.string().uuid(),
        planName: z.string().min(1),
        planInterval: z.enum(['monthly', 'annual', 'one_time']),
        returnUrl: z.string().url().optional(),
      });

      const validated = schema.parse(req.body);
      const { storeId, planName, planInterval, returnUrl } = validated;

      // Verify store exists
      const store = await StoreModel.findById(storeId);
      if (!store) {
        res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Store not found',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }

      // Plan pricing
      const planAmounts: Record<string, string> = {
        starter: '9.99',
        professional: '29.99',
        enterprise: '99.99',
      };

      const amount = planAmounts[planName] || '9.99';

      // Build the charge creation payload for the Shopify Billing API
      const chargePayload = {
        recurring_application_charge: {
          name: `Shopify Oracle Integration - ${planName}`,
          price: amount,
          return_url: returnUrl || `${config.shopify.appUrl}/api/billing/callback`,
          test: config.isDevelopment,
          trial_days: planInterval === 'monthly' ? 14 : 30,
        },
      };

      logger.info('Billing charge creation initiated', {
        storeId,
        planName,
        planInterval,
        amount,
        requestId: req.requestId,
      });

      res.json({
        success: true,
        data: {
          planName,
          planInterval,
          amount,
          chargePayload,
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid billing request data',
            details: error.errors.map((e) => ({
              path: e.path.join('.'),
              message: e.message,
            })),
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }
      next(error);
    }
  }

  /**
   * POST /api/billing/callback
   *
   * Handle the callback from Shopify's Billing API after a merchant
   * approves or declines a charge. Creates or updates the subscription
   * record based on the callback data.
   */
  async handleCallback(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const schema = z.object({
        storeId: z.string().uuid(),
        shopifySubscriptionId: z.string(),
        planName: z.string(),
        planInterval: z.string(),
        status: z.string(),
        trialEndsAt: z.string().datetime().optional(),
        currentPeriodEndsAt: z.string().datetime().optional(),
      });

      const validated = schema.parse(req.body);
      const {
        storeId,
        shopifySubscriptionId,
        planName,
        planInterval,
        status,
      } = validated;

      // Check if a subscription already exists for this store
      const existing = await BillingModel.findByStoreId(storeId);

      if (existing) {
        // Update existing subscription
        await BillingModel.updateStatus(storeId, status);
        logger.info('Billing subscription updated via callback', {
          storeId,
          shopifySubscriptionId,
          status,
          requestId: req.requestId,
        });
      } else {
        // Create new subscription
        await BillingModel.create({
          storeId,
          shopifySubscriptionId,
          planName,
          planInterval,
          status,
          trialEndsAt: validated.trialEndsAt
            ? new Date(validated.trialEndsAt)
            : null,
          currentPeriodEndsAt: validated.currentPeriodEndsAt
            ? new Date(validated.currentPeriodEndsAt)
            : null,
        });
        logger.info('Billing subscription created via callback', {
          storeId,
          shopifySubscriptionId,
          planName,
          status,
          requestId: req.requestId,
        });
      }

      res.json({
        success: true,
        data: { message: 'Billing subscription processed successfully' },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid callback data',
            details: error.errors.map((e) => ({
              path: e.path.join('.'),
              message: e.message,
            })),
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }
      next(error);
    }
  }

  /**
   * POST /api/billing/cancel
   *
   * Cancel the current billing subscription for a store.
   */
  async cancelSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const schema = z.object({
        storeId: z.string().uuid(),
      });

      const validated = schema.parse(req.body);
      const { storeId } = validated;

      const subscription = await BillingModel.findByStoreId(storeId);
      if (!subscription) {
        res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'No billing subscription found for this store',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }

      await BillingModel.cancel(storeId);

      logger.info('Billing subscription cancelled', {
        storeId,
        requestId: req.requestId,
      });

      res.json({
        success: true,
        data: { message: 'Billing subscription cancelled successfully' },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }
      next(error);
    }
  }
}

export default BillingController;
