import { FieldMappingModel } from '../../models/field-mapping.model';
import { logger } from '../../utils/logger';
import type { EntityType, SyncDirection, FieldMapping, TransformRule } from '@shared/types';
import {
  getNestedValue as sharedGetNestedValue,
  setNestedValue as sharedSetNestedValue,
  applyTransform as sharedApplyTransform,
  mapRecord,
} from '@shared/utils';

export type { FieldMappingDef } from '@shared/utils';

/**
 * Service responsible for loading field mapping configurations from the
 * database and applying them to transform records between Shopify and Oracle
 * data formats.
 *
 * The service wraps the shared field-mapping utility functions with
 * database-backed configuration loading per store.
 */
export class FieldMapperService {
  private readonly storeId: string;
  private mappingsCache: Map<string, FieldMapping[]> = new Map();

  /**
   * @param storeId - The store ID for which to load field mappings.
   */
  constructor(storeId: string) {
    this.storeId = storeId;
  }

  /**
   * Load field mappings from the database for a given entity type and sync
   * direction. Results are cached in memory per (entityType + direction) key
   * for the lifetime of this service instance.
   *
   * @param entityType - The entity type to load mappings for.
   * @param direction - The sync direction to load mappings for.
   * @returns Array of field mapping configurations.
   */
  async loadMappings(
    entityType: EntityType,
    direction: SyncDirection,
  ): Promise<FieldMapping[]> {
    const cacheKey = `${entityType}:${direction}`;

    if (this.mappingsCache.has(cacheKey)) {
      return this.mappingsCache.get(cacheKey)!;
    }

    try {
      const mappings = await FieldMappingModel.findByStoreAndEntity(
        this.storeId,
        entityType,
        direction,
      );

      // If no custom mappings exist, fall back to defaults
      if (mappings.length === 0) {
        logger.debug('No custom mappings found, using defaults', {
          storeId: this.storeId,
          entityType,
          direction,
        });
        const defaults = await FieldMappingModel.getDefaults(entityType);
        // Convert DefaultFieldMapping[] to FieldMapping[] shape
        return defaults.map((d, index) => ({
          id: `default-${entityType}-${direction}-${index}`,
          storeId: this.storeId,
          entityType,
          direction,
          shopifyField: d.shopifyField,
          oracleField: d.oracleField,
          transformRule: d.transformRule,
          isRequired: d.isRequired,
          createdAt: new Date(),
          updatedAt: new Date(),
        }));
      }

      this.mappingsCache.set(cacheKey, mappings);
      return mappings;
    } catch (error) {
      logger.error('Failed to load field mappings', {
        storeId: this.storeId,
        entityType,
        direction,
        error: (error as Error).message,
      });

      // Fall back to defaults on error
      const defaults = await FieldMappingModel.getDefaults(entityType);
      return defaults.map((d, index) => ({
        id: `default-${entityType}-${direction}-${index}`,
        storeId: this.storeId,
        entityType,
        direction,
        shopifyField: d.shopifyField,
        oracleField: d.oracleField,
        transformRule: d.transformRule,
        isRequired: d.isRequired,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
    }
  }

  /**
   * Transform a single record from source format to target format using
   * the stored field mappings for the given entity type and direction.
   *
   * @param sourceRecord - The source record to transform.
   * @param entityType - The entity type for mapping rules.
   * @param direction - The sync direction (determines field mapping orientation).
   * @returns The transformed record in target format.
   */
  async transform(
    sourceRecord: Record<string, unknown>,
    entityType: EntityType,
    direction: SyncDirection,
  ): Promise<Record<string, unknown>> {
    const mappings = await this.loadMappings(entityType, direction);
    const reverse = direction === 'oracle_to_shopify';

    try {
      const result = mapRecord(sourceRecord, mappings, reverse);
      logger.debug('Record transformed', {
        entityType,
        direction,
        mappingsCount: mappings.length,
        sourceKeys: Object.keys(sourceRecord).length,
        targetKeys: Object.keys(result).length,
      });
      return result;
    } catch (error) {
      logger.error('Failed to transform record', {
        entityType,
        direction,
        error: (error as Error).message,
      });
      throw new Error(
        `Field mapping transformation failed for ${entityType} (${direction}): ${(error as Error).message}`,
      );
    }
  }

  /**
   * Transform a batch of records from source format to target format using
   * the stored field mappings.
   *
   * @param records - Array of source records to transform.
   * @param entityType - The entity type for mapping rules.
   * @param direction - The sync direction.
   * @returns Array of transformed records in target format.
   */
  async transformBatch(
    records: Record<string, unknown>[],
    entityType: EntityType,
    direction: SyncDirection,
  ): Promise<Record<string, unknown>[]> {
    if (records.length === 0) {
      return [];
    }

    const mappings = await this.loadMappings(entityType, direction);
    const reverse = direction === 'oracle_to_shopify';

    const results: Record<string, unknown>[] = [];
    const errors: Array<{ index: number; error: string }> = [];

    for (let i = 0; i < records.length; i++) {
      try {
        const transformed = mapRecord(records[i], mappings, reverse);
        results.push(transformed);
      } catch (error) {
        errors.push({
          index: i,
          error: (error as Error).message,
        });
        // Still push the original record so callers can handle partial failures
        results.push(records[i]);
      }
    }

    if (errors.length > 0) {
      logger.warn('Batch transform had errors', {
        entityType,
        direction,
        totalRecords: records.length,
        errorCount: errors.length,
        errors: errors.slice(0, 5), // Log only first 5 to avoid flooding
      });
    }

    return results;
  }

  /**
   * Apply a single transform rule to a value.
   * Delegates to the shared applyTransform utility.
   *
   * Supported rule types:
   * - direct: Returns the value unchanged.
   * - concat: Joins fields with a separator.
   * - split: Extracts a specific index after splitting by a separator.
   * - formula: Multiplies a numeric value by a factor.
   * - lookup: Maps a value through a key-value lookup table.
   * - date_format: Converts date values between formats.
   * - custom: Passthrough for application-specific logic.
   *
   * @param value - The input value to transform.
   * @param rule - The transform rule configuration.
   * @returns The transformed value.
   */
  private applyTransform(value: unknown, rule: TransformRule): unknown {
    return sharedApplyTransform(value, rule);
  }

  /**
   * Retrieve a nested value from an object using dot-notation path.
   *
   * @example
   * getNestedValue({ a: { b: 42 } }, 'a.b') // => 42
   *
   * @param obj - The object to traverse.
   * @param path - Dot-separated path to the desired value.
   * @returns The value at the path, or undefined if not found.
   */
  private getNestedValue(
    obj: Record<string, unknown>,
    path: string,
  ): unknown {
    return sharedGetNestedValue(obj, path);
  }

  /**
   * Set a nested value in an object using dot-notation path, creating
   * intermediate objects or arrays as needed.
   *
   * @example
   * const obj = {};
   * setNestedValue(obj, 'a.b', 42);
   * // obj => { a: { b: 42 } }
   *
   * @param obj - The target object to mutate.
   * @param path - Dot-separated path indicating where to place the value.
   * @param value - The value to set.
   */
  private setNestedValue(
    obj: Record<string, unknown>,
    path: string,
    value: unknown,
  ): void {
    sharedSetNestedValue(obj, path, value);
  }
}

export default FieldMapperService;
