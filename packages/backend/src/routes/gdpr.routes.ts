import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { logger } from '../utils/logger';
import {
  handleCustomerDataRequest,
  handleCustomerRedact,
  handleShopRedact,
} from '../utils/gdpr';

const router = Router();

/**
 * POST /api/gdpr/customers/data_request
 * Handle a GDPR customer data request from Shopify.
 *
 * Shopify sends this webhook when a customer requests all data
 * that the app holds about them. The app must respond with the data
 * or return an acknowledgment.
 */
router.post('/customers/data_request', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      shop_id: z.union([z.string(), z.number()]),
      shop_domain: z.string(),
      customer: z.object({
        id: z.union([z.string(), z.number()]),
        email: z.string().email().optional(),
        phone: z.string().optional(),
      }),
      orders_requested: z.array(z.any()).optional(),
    });

    const validated = schema.parse(req.body);
    const storeId = String(validated.shop_id);
    const customerId = String(validated.customer.id);

    logger.info('GDPR customer data request received', {
      storeId,
      customerId,
      shopDomain: validated.shop_domain,
    });

    const customerData = await handleCustomerDataRequest(storeId, customerId);

    // The data should be returned or sent to the customer
    // In this implementation, we acknowledge receipt and log the data.
    // Production would typically email the data to the customer.

    res.json({
      success: true,
      data: {
        message: 'Customer data request received and processed',
        dataAvailable: Object.keys(customerData).length > 0,
      },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('GDPR customer data request validation failed', {
        errors: error.errors,
      });
      // Still return 200 to acknowledge Shopify's delivery
      res.json({
        success: true,
        data: { message: 'Customer data request acknowledged' },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
      return;
    }
    next(error);
  }
});

/**
 * POST /api/gdpr/customers/redact
 * Handle a GDPR customer data redaction request from Shopify.
 *
 * Shopify sends this webhook when a customer requests deletion
 * of all personal data the app holds about them.
 */
router.post('/customers/redact', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      shop_id: z.union([z.string(), z.number()]),
      shop_domain: z.string(),
      customer: z.object({
        id: z.union([z.string(), z.number()]),
        email: z.string().email().optional(),
        phone: z.string().optional(),
      }),
    });

    const validated = schema.parse(req.body);
    const storeId = String(validated.shop_id);
    const customerId = String(validated.customer.id);

    logger.info('GDPR customer redaction request received', {
      storeId,
      customerId,
      shopDomain: validated.shop_domain,
    });

    await handleCustomerRedact(storeId, customerId);

    logger.info('GDPR customer redaction completed', {
      storeId,
      customerId,
    });

    res.json({
      success: true,
      data: { message: 'Customer data redacted successfully' },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('GDPR customer redaction validation failed', {
        errors: error.errors,
      });
      res.json({
        success: true,
        data: { message: 'Customer redaction acknowledged' },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
      return;
    }
    next(error);
  }
});

/**
 * POST /api/gdpr/shop/redact
 * Handle a GDPR shop data redaction request from Shopify.
 *
 * Shopify sends this webhook 48 hours after a store owner uninstalls
 * the app. The app must delete all data associated with the store.
 */
router.post('/shop/redact', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      shop_id: z.union([z.string(), z.number()]),
      shop_domain: z.string(),
    });

    const validated = schema.parse(req.body);
    const storeId = String(validated.shop_id);

    logger.info('GDPR shop redaction request received', {
      storeId,
      shopDomain: validated.shop_domain,
    });

    await handleShopRedact(storeId);

    logger.info('GDPR shop redaction completed', {
      storeId,
    });

    res.json({
      success: true,
      data: { message: 'Shop data redacted successfully' },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('GDPR shop redaction validation failed', {
        errors: error.errors,
      });
      res.json({
        success: true,
        data: { message: 'Shop redaction acknowledged' },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
      return;
    }
    next(error);
  }
});

export default router;
