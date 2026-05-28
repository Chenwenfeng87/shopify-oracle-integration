import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { shopifyAuth } from '../middleware/shopify-auth';
import { FieldMappingModel } from '../models/field-mapping.model';
import { StoreModel } from '../models/store.model';
import { logger } from '../utils/logger';
import type { EntityType, SyncDirection } from '@shared/types';

const router = Router();

// All mapping routes require authentication
router.use(shopifyAuth);

/**
 * GET /api/mappings
 * Retrieve all field mappings for a store, optionally filtered by entity type and direction.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      storeId: z.string().uuid(),
      entityType: z.enum(['item', 'customer', 'order', 'price', 'inventory']).optional(),
      direction: z.enum(['shopify_to_oracle', 'oracle_to_shopify']).optional(),
    });

    const validated = schema.parse(req.query);
    const { storeId, entityType, direction } = validated;

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

    let mappings;

    if (entityType && direction) {
      // Get specific entity type and direction
      mappings = await FieldMappingModel.findByStoreAndEntity(
        storeId,
        entityType as EntityType,
        direction as SyncDirection,
      );
    } else {
      // Get all mappings for the store (iterate all entities)
      const entityTypes: EntityType[] = ['item', 'customer', 'order', 'price', 'inventory'];
      const directions: SyncDirection[] = ['shopify_to_oracle', 'oracle_to_shopify'];
      const allMappings = [];

      for (const et of entityTypes) {
        for (const dir of directions) {
          const entityMappings = await FieldMappingModel.findByStoreAndEntity(storeId, et, dir);
          allMappings.push(...entityMappings);
        }
      }
      mappings = allMappings;
    }

    res.json({
      success: true,
      data: mappings,
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
          details: error.errors.map((e) => ({ path: e.path.join('.'), message: e.message })),
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
});

/**
 * GET /api/mappings/defaults
 * Get the default field mappings for a given entity type.
 */
router.get('/defaults', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      entityType: z.enum(['item', 'customer', 'order', 'price', 'inventory']),
    });

    const validated = schema.parse(req.query);
    const defaults = await FieldMappingModel.getDefaults(validated.entityType as EntityType);

    res.json({
      success: true,
      data: defaults,
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
});

/**
 * POST /api/mappings/bulk
 * Bulk create or replace field mappings for a store, entity type, and direction.
 * This deletes all existing mappings for the combination and inserts the new ones.
 */
router.post('/bulk', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      storeId: z.string().uuid(),
      entityType: z.enum(['item', 'customer', 'order', 'price', 'inventory']),
      direction: z.enum(['shopify_to_oracle', 'oracle_to_shopify']),
      mappings: z.array(
        z.object({
          shopifyField: z.string().min(1),
          oracleField: z.string().min(1),
          transformRule: z
            .object({
              type: z.enum(['direct', 'concat', 'split', 'formula', 'lookup', 'date_format', 'custom']),
              config: z.record(z.unknown()),
            })
            .nullable()
            .optional(),
          isRequired: z.boolean().optional(),
        }),
      ).min(1),
    });

    const validated = schema.parse(req.body);
    const { storeId, entityType, direction, mappings } = validated;

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

    // Delete existing mappings for this combination
    await FieldMappingModel.deleteAll(storeId, entityType as EntityType);

    // Create the new mappings
    const created = await FieldMappingModel.bulkCreate(
      mappings.map((m) => ({
        storeId,
        entityType: entityType as EntityType,
        direction: direction as SyncDirection,
        shopifyField: m.shopifyField,
        oracleField: m.oracleField,
        transformRule: m.transformRule ?? null,
        isRequired: m.isRequired ?? false,
      })),
    );

    logger.info('Field mappings updated', {
      storeId,
      entityType,
      direction,
      count: created.length,
    });

    res.status(201).json({
      success: true,
      data: created,
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
          message: 'Invalid mapping data',
          details: error.errors.map((e) => ({ path: e.path.join('.'), message: e.message })),
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
});

/**
 * POST /api/mappings
 * Create a single field mapping.
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      storeId: z.string().uuid(),
      entityType: z.enum(['item', 'customer', 'order', 'price', 'inventory']),
      direction: z.enum(['shopify_to_oracle', 'oracle_to_shopify']),
      shopifyField: z.string().min(1),
      oracleField: z.string().min(1),
      transformRule: z
        .object({
          type: z.enum(['direct', 'concat', 'split', 'formula', 'lookup', 'date_format', 'custom']),
          config: z.record(z.unknown()),
        })
        .nullable()
        .optional(),
      isRequired: z.boolean().optional(),
    });

    const validated = schema.parse(req.body);
    const { storeId, ...mappingData } = validated;

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

    const mapping = await FieldMappingModel.create({
      storeId,
      ...mappingData,
    });

    res.status(201).json({
      success: true,
      data: mapping,
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
          message: 'Invalid mapping data',
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
});

/**
 * PUT /api/mappings/:id
 * Update a specific field mapping.
 */
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const schema = z.object({
      shopifyField: z.string().min(1).optional(),
      oracleField: z.string().min(1).optional(),
      transformRule: z
        .object({
          type: z.enum(['direct', 'concat', 'split', 'formula', 'lookup', 'date_format', 'custom']),
          config: z.record(z.unknown()),
        })
        .nullable()
        .optional(),
      isRequired: z.boolean().optional(),
    });

    const validated = schema.parse(req.body);

    const updated = await FieldMappingModel.update(id, validated);

    res.json({
      success: true,
      data: updated,
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
          message: 'Invalid mapping data',
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
});

/**
 * DELETE /api/mappings/:id
 * Delete a specific field mapping.
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    await FieldMappingModel.delete(id);

    res.json({
      success: true,
      data: { message: 'Field mapping deleted successfully' },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
