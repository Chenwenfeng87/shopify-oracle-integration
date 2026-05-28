/**
 * Field mapping utility for transforming records between Shopify and Oracle formats.
 *
 * Supports nested field access via dot notation and a variety of transform rules
 * (direct, concat, split, formula, lookup, date_format, custom).
 */

import type { TransformRule } from '../types';

/**
 * Definition of a single field mapping.
 */
export interface FieldMappingDef {
  /** Path to the field in the Shopify record (dot notation supported). */
  shopifyField: string;
  /** Path to the field in the Oracle record (dot notation supported). */
  oracleField: string;
  /** Optional transform to apply during mapping. */
  transformRule?: TransformRule | null;
}

/**
 * Retrieve a nested value from an object using dot-separated path notation.
 *
 * @example
 * getNestedValue({ a: { b: 42 } }, 'a.b')  // => 42
 * getNestedValue({ x: [1, { y: 2 }] }, 'x.1.y')  // => 2
 *
 * @param obj - The source object.
 * @param path - Dot-separated path to the desired value.
 * @returns The value at the path, or `undefined` if any segment is missing.
 */
export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = obj;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[key];
  }

  return current;
}

/**
 * Set a nested value in an object using dot-separated path notation, creating
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
export function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const keys = path.split('.');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];

    // If the next key looks like an array index and key is missing, create an array.
    const nextKey = keys[i + 1];
    const isNextIndex = /^\d+$/.test(nextKey);

    if (current[key] === undefined || current[key] === null) {
      current[key] = isNextIndex ? [] : {};
    }

    current = current[key];
  }

  const lastKey = keys[keys.length - 1];
  current[lastKey] = value;
}

/**
 * Apply a transform rule to a value.
 *
 * Supported rule types:
 * - **direct**: Returns the value unchanged.
 * - **concat**: Joins an array of source values with the configured separator.
 * - **split**: Extracts a specific index after splitting by a separator.
 * - **formula**: Multiplies a numeric value by a factor.
 * - **lookup**: Maps a value through a key-value lookup table.
 * - **date_format**: Converts a date value to a target format string.
 * - **custom**: Returns the value unchanged (placeholder for custom logic).
 *
 * @param value - The input value to transform.
 * @param rule - The transform rule describing how to transform.
 * @returns The transformed value.
 */
export function applyTransform(value: unknown, rule: TransformRule): unknown {
  switch (rule.type) {
    case 'direct':
      return value;

    case 'concat': {
      const fields = rule.config.fields as string[] | undefined;
      const separator = (rule.config.separator as string) ?? ' ';
      if (!Array.isArray(fields) || fields.length === 0) {
        return value;
      }
      return fields
        .map((f) => String(value !== undefined ? (value as Record<string, unknown>)[f] ?? '' : ''))
        .join(separator);
    }

    case 'split': {
      const separator = (rule.config.separator as string) ?? ',';
      const index = (rule.config.index as number) ?? 0;
      const str = String(value ?? '');
      const parts = str.split(separator);
      return parts[index] ?? '';
    }

    case 'formula': {
      const factor = (rule.config.factor as number) ?? 1;
      const num = typeof value === 'number' ? value : Number(value);
      if (isNaN(num)) {
        return value;
      }
      return num * factor;
    }

    case 'lookup': {
      const mapping = rule.config.mapping as Record<string, unknown> | undefined;
      if (!mapping || typeof mapping !== 'object') {
        return value;
      }
      const key = String(value);
      return key in mapping ? mapping[key] : value;
    }

    case 'date_format': {
      const sourceFormat = rule.config.sourceFormat as string | undefined;
      const targetFormat = rule.config.targetFormat as string | undefined;

      // If no formats are specified, return the value as-is.
      if (!sourceFormat && !targetFormat) {
        return value;
      }

      // Basic ISO date string handling. For complex date formatting needs,
      // consumers should use a dedicated date library (e.g., date-fns, moment).
      if (typeof value === 'string' || typeof value === 'number' || value instanceof Date) {
        const date = value instanceof Date ? value : new Date(value);
        if (isNaN(date.getTime())) {
          return value;
        }

        if (targetFormat === 'iso' || !targetFormat) {
          return date.toISOString();
        }

        if (targetFormat === 'date') {
          return date.toISOString().split('T')[0];
        }

        if (targetFormat === 'timestamp') {
          return date.getTime();
        }

        // Return ISO string as default.
        return date.toISOString();
      }

      return value;
    }

    case 'custom':
      // Custom transforms are expected to be handled externally
      // by consumer code that post-processes mapped records.
      return value;

    default:
      return value;
  }
}

/**
 * Map a record from one format to another using the provided field mappings.
 *
 * When `reverse` is `false` (default), fields are mapped from Shopify to Oracle.
 * When `reverse` is `true`, the direction is reversed (Oracle to Shopify).
 *
 * @param source - The source record containing field values.
 * @param mappings - Array of field mapping definitions.
 * @param reverse - If true, map from oracleField to shopifyField (reverse direction).
 * @returns A new record with mapped fields.
 */
export function mapRecord(
  source: Record<string, unknown>,
  mappings: FieldMappingDef[],
  reverse: boolean = false,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const mapping of mappings) {
    const sourceField = reverse ? mapping.oracleField : mapping.shopifyField;
    const targetField = reverse ? mapping.shopifyField : mapping.oracleField;

    let value = getNestedValue(source, sourceField);

    if (mapping.transformRule) {
      value = applyTransform(value, mapping.transformRule);
    }

    if (value !== undefined) {
      setNestedValue(result, targetField, value);
    }
  }

  return result;
}
