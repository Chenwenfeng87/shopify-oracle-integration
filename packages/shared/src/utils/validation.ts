/**
 * Validation schemas and utilities for the Shopify-Oracle integration.
 *
 * Uses Zod to validate configuration inputs, field mappings, and identifiers
 * before they reach the business logic layer.
 */

import { z } from 'zod';
import type { SyncConfig, EntityType, SyncFrequency, ConflictStrategy, TransformRule } from '../types';

// ---------------------------------------------------------------------------
// Primitive schemas
// ---------------------------------------------------------------------------

/**
 * Validates a Shopify store domain.
 * Must match the pattern: `<store>.myshopify.com`
 */
export const shopifyDomainSchema = z
  .string()
  .min(1, 'Shopify domain is required')
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/,
    'Domain must be a valid Shopify store domain (e.g., my-store.myshopify.com)',
  );

/**
 * Validates a fully-qualified Oracle Cloud URL.
 */
export const oracleUrlSchema = z
  .string()
  .url('Oracle URL must be a valid URL')
  .min(1, 'Oracle URL is required');

// ---------------------------------------------------------------------------
// Entity schemas
// ---------------------------------------------------------------------------

const entityTypeSchema = z.enum(['item', 'customer', 'order', 'price', 'inventory'] as const);
const syncDirectionSchema = z.enum(['shopify_to_oracle', 'oracle_to_shopify'] as const);
const syncFrequencySchema = z.enum(['real_time', 'scheduled', 'manual'] as const);
const conflictStrategySchema = z.enum(['source_wins', 'target_wins', 'manual', 'merge'] as const);

// ---------------------------------------------------------------------------
// Transform rule schema
// ---------------------------------------------------------------------------

/**
 * Validates a transform rule configuration.
 */
export const transformRuleSchema: z.ZodType<TransformRule> = z.object({
  type: z.enum(['direct', 'concat', 'split', 'formula', 'lookup', 'date_format', 'custom']),
  config: z.record(z.string(), z.unknown()),
});

// ---------------------------------------------------------------------------
// Field mapping schema
// ---------------------------------------------------------------------------

/**
 * Validates a field mapping input object.
 * This validates the data needed to create or update a field mapping
 * (excluding server-generated fields like id, createdAt, updatedAt).
 */
export const fieldMappingSchema = z.object({
  storeId: z.string().min(1, 'Store ID is required'),
  entityType: entityTypeSchema,
  direction: syncDirectionSchema,
  shopifyField: z.string().min(1, 'Shopify field path is required'),
  oracleField: z.string().min(1, 'Oracle field path is required'),
  transformRule: transformRuleSchema.nullable().optional().default(null),
  isRequired: z.boolean().optional().default(false),
});

/**
 * Inferred type for validated field mapping input.
 */
export type FieldMappingInput = z.infer<typeof fieldMappingSchema>;

// ---------------------------------------------------------------------------
// Sync configuration schema
// ---------------------------------------------------------------------------

/**
 * Validates a sync configuration input object.
 * This validates the data needed to create or update a sync configuration
 * (excluding server-generated fields like id, createdAt, updatedAt).
 */
export const syncConfigSchema = z.object({
  storeId: z.string().min(1, 'Store ID is required'),
  entityType: entityTypeSchema,
  frequency: syncFrequencySchema,
  cronExpression: z
    .string()
    .nullable()
    .optional()
    .default(null),
  isEnabled: z.boolean().optional().default(true),
  batchSize: z
    .number()
    .int('Batch size must be an integer')
    .min(1, 'Batch size must be at least 1')
    .max(500, 'Batch size must not exceed 500')
    .optional()
    .default(100),
  conflictStrategy: conflictStrategySchema.optional().default('source_wins'),
});

/**
 * Inferred type for validated sync config input.
 */
export type SyncConfigInput = z.infer<typeof syncConfigSchema>;

// ---------------------------------------------------------------------------
// Validation functions
// ---------------------------------------------------------------------------

/**
 * Validate a Shopify store domain string.
 *
 * @returns `true` if the domain is valid, `false` otherwise.
 */
export function validateShopifyDomain(domain: string): boolean {
  const result = shopifyDomainSchema.safeParse(domain);
  return result.success;
}

/**
 * Validate an Oracle Cloud URL string.
 *
 * @returns `true` if the URL is valid, `false` otherwise.
 */
export function validateOracleUrl(url: string): boolean {
  const result = oracleUrlSchema.safeParse(url);
  return result.success;
}

/**
 * Validate an unknown sync configuration input.
 *
 * Parses the input against `syncConfigSchema` and returns a validated
 * `SyncConfig` object. Server-generated fields (id, createdAt, updatedAt)
 * are not validated here and should be set by the caller.
 *
 * @param config - The raw config input to validate.
 * @returns A validated SyncConfig-like object.
 * @throws {z.ZodError} If validation fails.
 */
export function validateSyncConfig(config: unknown): SyncConfig {
  return syncConfigSchema.parse(config) as SyncConfig;
}
