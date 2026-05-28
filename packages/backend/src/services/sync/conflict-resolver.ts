import { logger } from '../../utils/logger';
import { getNestedValue, setNestedValue } from '@shared/utils';
import type { FieldMapping, ConflictStrategy } from '@shared/types';

/**
 * Result of a conflict resolution operation.
 */
export interface ConflictResolutionResult {
  /** The resolved record after applying the conflict strategy. */
  resolved: Record<string, unknown>;
  /** The strategy that was used for resolution. */
  strategy: ConflictStrategy;
  /** List of fields that were successfully resolved. */
  conflictsResolved: string[];
  /** List of fields that could not be resolved (merge conflicts with no timestamp). */
  conflictsUnresolved: string[];
  /** Whether this result requires manual review by an administrator. */
  requiresManualReview: boolean;
}

/**
 * Service responsible for detecting and resolving data conflicts between
 * source and target records during synchronization.
 *
 * Conflicts occur when both the source and target systems have modified the
 * same field since the last sync. The ConflictResolver applies a configurable
 * strategy to determine which value should be used.
 */
export class ConflictResolver {
  /**
   * Detect whether there are conflicts between a source record and a
   * target record based on the provided field mappings.
   *
   * A conflict exists when both records have different non-null values
   * for a mapped field.
   *
   * @param source - The record from the source system.
   * @param target - The record from the target system.
   * @param fieldMappings - The field mappings defining which fields to compare.
   * @returns Object indicating whether conflicts exist and which fields conflict.
   */
  detectConflict(
    source: Record<string, unknown>,
    target: Record<string, unknown>,
    fieldMappings: FieldMapping[],
  ): { hasConflict: boolean; conflictingFields: string[] } {
    const conflictingFields: string[] = [];

    for (const mapping of fieldMappings) {
      const sourceValue = getNestedValue(source, mapping.shopifyField);
      const targetValue = getNestedValue(target, mapping.oracleField);

      // Both must be defined to have a conflict
      if (sourceValue === undefined || targetValue === undefined) {
        continue;
      }

      // Convert to comparable strings for deep comparison
      const sourceStr = JSON.stringify(sourceValue);
      const targetStr = JSON.stringify(targetValue);

      if (sourceStr !== targetStr) {
        conflictingFields.push(mapping.shopifyField);
      }
    }

    return {
      hasConflict: conflictingFields.length > 0,
      conflictingFields,
    };
  }

  /**
   * Resolve conflicts between source and target records using the specified
   * strategy.
   *
   * @param source - The record from the source system.
   * @param target - The record from the target system.
   * @param fieldMappings - The field mappings defining which fields to compare.
   * @param strategy - The conflict resolution strategy to apply.
   * @returns A ConflictResolutionResult with the resolved record and metadata.
   */
  resolve(
    source: Record<string, unknown>,
    target: Record<string, unknown>,
    fieldMappings: FieldMapping[],
    strategy: ConflictStrategy,
  ): ConflictResolutionResult {
    logger.debug('Resolving conflicts', {
      strategy,
      sourceKeys: Object.keys(source).length,
      targetKeys: Object.keys(target).length,
      mappingCount: fieldMappings.length,
    });

    switch (strategy) {
      case 'source_wins':
        return this.resolveWithStrategy(
          source,
          target,
          fieldMappings,
          strategy,
          this.resolveSourceWins.bind(this),
        );

      case 'target_wins':
        return this.resolveWithStrategy(
          source,
          target,
          fieldMappings,
          strategy,
          this.resolveTargetWins.bind(this),
        );

      case 'merge':
        return this.resolveMergeStrategy(source, target, fieldMappings);

      case 'manual':
        return this.resolveManualStrategy(source, target, fieldMappings);

      default:
        logger.warn('Unknown conflict strategy, falling back to source_wins', {
          strategy,
        });
        return this.resolveWithStrategy(
          source,
          target,
          fieldMappings,
          'source_wins',
          this.resolveSourceWins.bind(this),
        );
    }
  }

  /**
   * Resolve conflicts by taking the value from the resolved record for all
   * conflicting fields. The resolver function determines which record wins.
   */
  private resolveWithStrategy(
    source: Record<string, unknown>,
    target: Record<string, unknown>,
    fieldMappings: FieldMapping[],
    strategy: ConflictStrategy,
    resolver: (
      source: Record<string, unknown>,
      target: Record<string, unknown>,
    ) => Record<string, unknown>,
  ): ConflictResolutionResult {
    const { conflictingFields } = this.detectConflict(source, target, fieldMappings);

    if (conflictingFields.length === 0) {
      // No conflicts — return source merged with target (no data loss)
      return {
        resolved: { ...target, ...source },
        strategy,
        conflictsResolved: [],
        conflictsUnresolved: [],
        requiresManualReview: false,
      };
    }

    const resolved = resolver(source, target);

    return {
      resolved,
      strategy,
      conflictsResolved: conflictingFields,
      conflictsUnresolved: [],
      requiresManualReview: false,
    };
  }

  /**
   * Source wins: all conflicting field values are taken from the source record.
   * Non-conflicting fields are merged from both records.
   */
  private resolveSourceWins(
    source: Record<string, unknown>,
    target: Record<string, unknown>,
  ): Record<string, unknown> {
    // Start with the target, then overlay source values.
    // This ensures source values win for any overlapping keys.
    return { ...target, ...source };
  }

  /**
   * Target wins: all conflicting field values are taken from the target record.
   * Non-conflicting fields are merged from both records.
   */
  private resolveTargetWins(
    source: Record<string, unknown>,
    target: Record<string, unknown>,
  ): Record<string, unknown> {
    // Start with the source, then overlay target values.
    // This ensures target values win for any overlapping keys.
    return { ...source, ...target };
  }

  /**
   * Merge strategy: non-conflicting fields are merged automatically.
   * Conflicting fields are compared by last_modified / updated_at timestamps.
   * If timestamps are unavailable or equal, the field is marked as unresolved.
   */
  private resolveMergeStrategy(
    source: Record<string, unknown>,
    target: Record<string, unknown>,
    fieldMappings: FieldMapping[],
  ): ConflictResolutionResult {
    const { conflictingFields } = this.detectConflict(source, target, fieldMappings);

    if (conflictingFields.length === 0) {
      return {
        resolved: { ...target, ...source },
        strategy: 'merge',
        conflictsResolved: [],
        conflictsUnresolved: [],
        requiresManualReview: false,
      };
    }

    // Start with merged non-conflicting fields (target base + source overlay)
    const resolved: Record<string, unknown> = { ...target, ...source };
    const resolvedFields: string[] = [];
    const unresolvedFields: string[] = [];

    // For each conflicting field, compare timestamps
    const sourceTimestamp = this.extractTimestamp(source);
    const targetTimestamp = this.extractTimestamp(target);

    for (const field of conflictingFields) {
      const sourceValue = getNestedValue(source, field);
      const targetValue = getNestedValue(target, field);

      if (sourceTimestamp && targetTimestamp) {
        if (sourceTimestamp >= targetTimestamp) {
          // Source is newer or equal — use source value
          setNestedValue(resolved, field, sourceValue);
          resolvedFields.push(field);
        } else {
          // Target is newer — use target value
          setNestedValue(resolved, field, targetValue);
          resolvedFields.push(field);
        }
      } else if (sourceTimestamp && !targetTimestamp) {
        // Only source has a timestamp — use source value
        setNestedValue(resolved, field, sourceValue);
        resolvedFields.push(field);
      } else if (!sourceTimestamp && targetTimestamp) {
        // Only target has a timestamp — use target value
        setNestedValue(resolved, field, targetValue);
        resolvedFields.push(field);
      } else {
        // Neither has a timestamp — mark as unresolved
        unresolvedFields.push(field);
      }
    }

    const requiresManualReview = unresolvedFields.length > 0;

    if (requiresManualReview) {
      logger.warn('Merge strategy left unresolved conflicts', {
        unresolvedCount: unresolvedFields.length,
        unresolvedFields,
      });
    }

    return {
      resolved,
      strategy: 'merge',
      conflictsResolved: resolvedFields,
      conflictsUnresolved: unresolvedFields,
      requiresManualReview,
    };
  }

  /**
   * Manual strategy: all conflicting fields are marked as unresolved and
   * require human intervention. Non-conflicting fields are merged normally.
   */
  private resolveManualStrategy(
    source: Record<string, unknown>,
    target: Record<string, unknown>,
    fieldMappings: FieldMapping[],
  ): ConflictResolutionResult {
    const { conflictingFields } = this.detectConflict(source, target, fieldMappings);

    if (conflictingFields.length === 0) {
      return {
        resolved: { ...target, ...source },
        strategy: 'manual',
        conflictsResolved: [],
        conflictsUnresolved: [],
        requiresManualReview: false,
      };
    }

    // Merge non-conflicting fields; conflicting fields retain their target
    // value so the source update is not applied without review.
    const resolved: Record<string, unknown> = { ...target };

    // Apply only non-conflicting source fields
    for (const key of Object.keys(source)) {
      if (!conflictingFields.includes(key)) {
        resolved[key] = source[key];
      }
    }

    logger.info('Manual resolution required', {
      conflictingFields,
      count: conflictingFields.length,
    });

    return {
      resolved,
      strategy: 'manual',
      conflictsResolved: [],
      conflictsUnresolved: conflictingFields,
      requiresManualReview: true,
    };
  }

  /**
   * Extract a comparable timestamp value from a record.
   * Checks for common timestamp field names in priority order.
   *
   * @param record - The record to extract a timestamp from.
   * @returns A numeric timestamp (Unix ms) or null if none found.
   */
  private extractTimestamp(record: Record<string, unknown>): number | null {
    const possibleFields = [
      'updated_at',
      'updatedAt',
      'last_modified',
      'lastModified',
      'modified_at',
      'modifiedAt',
      'updated',
    ];

    for (const field of possibleFields) {
      const value = record[field];
      if (value !== undefined && value !== null) {
        if (value instanceof Date) {
          return value.getTime();
        }
        if (typeof value === 'string' || typeof value === 'number') {
          const parsed = new Date(value).getTime();
          if (!isNaN(parsed)) {
            return parsed;
          }
        }
      }
    }

    return null;
  }
}

export default ConflictResolver;
