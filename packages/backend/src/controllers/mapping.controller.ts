import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { FieldMappingModel } from '../models/field-mapping.model';
import { StoreModel } from '../models/store.model';
import { logger } from '../utils/logger';
import type { EntityType, SyncDirection } from '@shared/types';

/**
 * Handles all field mapping-related HTTP requests:
 *
 * - GET    /api/mappings              — List mappings with entity/direction filter
 * - GET    /api/mappings/defaults/:entityType — Get default mappings for an entity
 * - POST   /api/mappings              — Create a single field mapping
 * - PUT    /api/mappings/:id          — Update a field mapping
 * - DELETE /api/mappings/:id          — Delete a field mapping
 * - POST   /api/mappings/bulk         — Replace all mappings for a store+entity+direction
 */
export class MappingController {
  /**
   * GET /api/mappings
   *
   * List field mappings for a store. Optionally filtered by entity type
   * and sync direction. If both entityType and direction are provided,
   * only matching mappings are returned.
   */
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
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
        // Get all mappings for the store across all entity/direction combos
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

      logger.debug('Field mappings listed', {
        storeId,
        count: mappings.length,
        filters: { entityType, direction },
        requestId: req.requestId,
      });

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
   * GET /api/mappings/defaults/:entityType
   *
   * Get the default field mappings for a given entity type.
   * These are the built-in mappings used when no custom mappings exist.
   */
  async getDefaults(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const schema = z.object({
        entityType: z.enum(['item', 'customer', 'order', 'price', 'inventory']),
      });

      const validated = schema.parse(req.params);
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
            message: 'Invalid entity type',
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
   * POST /api/mappings
   *
   * Create a single field mapping.
   */
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
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
        entityType: mappingData.entityType as EntityType,
        direction: mappingData.direction as SyncDirection,
        shopifyField: mappingData.shopifyField,
        oracleField: mappingData.oracleField,
        transformRule: mappingData.transformRule ?? null,
        isRequired: mappingData.isRequired ?? false,
      });

      logger.info('Field mapping created', {
        mappingId: mapping.id,
        storeId,
        entityType: mappingData.entityType,
        requestId: req.requestId,
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
   * PUT /api/mappings/:id
   *
   * Update a specific field mapping by ID.
   * Only provided fields will be updated.
   */
  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const paramsSchema = z.object({
        id: z.string().uuid(),
      });

      const bodySchema = z.object({
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

      const { id } = paramsSchema.parse(req.params);
      const updates = bodySchema.parse(req.body);

      const updated = await FieldMappingModel.update(id, updates);

      logger.info('Field mapping updated', {
        mappingId: id,
        requestId: req.requestId,
      });

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
   * DELETE /api/mappings/:id
   *
   * Delete a specific field mapping by ID.
   */
  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const schema = z.object({
        id: z.string().uuid(),
      });

      const { id } = schema.parse(req.params);

      await FieldMappingModel.delete(id);

      logger.info('Field mapping deleted', {
        mappingId: id,
        requestId: req.requestId,
      });

      res.json({
        success: true,
        data: { message: 'Field mapping deleted successfully' },
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
            message: 'Invalid mapping ID',
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
   * POST /api/mappings/bulk
   *
   * Replace all field mappings for a given store, entity type, and direction.
   * Deletes all existing mappings for the combination and inserts the new ones
   * in a single transaction.
   */
  async bulkReplace(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const schema = z.object({
        storeId: z.string().uuid(),
        entityType: z.enum(['item', 'customer', 'order', 'price', 'inventory']),
        direction: z.enum(['shopify_to_oracle', 'oracle_to_shopify']),
        mappings: z
          .array(
            z.object({
              shopifyField: z.string().min(1),
              oracleField: z.string().min(1),
              transformRule: z
                .object({
                  type: z.enum([
                    'direct',
                    'concat',
                    'split',
                    'formula',
                    'lookup',
                    'date_format',
                    'custom',
                  ]),
                  config: z.record(z.unknown()),
                })
                .nullable()
                .optional(),
              isRequired: z.boolean().optional(),
            }),
          )
          .min(1),
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

      logger.info('Field mappings bulk replaced', {
        storeId,
        entityType,
        direction,
        count: created.length,
        requestId: req.requestId,
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
}

export default MappingController;
