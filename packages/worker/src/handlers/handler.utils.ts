import axios, { AxiosInstance } from 'axios';
import {
  SyncQueueMessage,
  FieldMappingRow,
  RecordResult,
  OracleApiResponse,
} from '../types';
import { getOracleCredentials, insertSyncLog, updateSyncJobProgress } from '../database';
import { logger } from '../logger';

/**
 * Build a Shopify Admin API axios instance authenticated with the store token.
 */
export function createShopifyClient(
  shopifyDomain: string,
  accessToken: string,
  apiVersion: string = '2024-07'
): AxiosInstance {
  const baseURL = `https://${shopifyDomain}/admin/api/${apiVersion}`;
  return axios.create({
    baseURL,
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });
}

/**
 * Obtain an Oracle Netsuite REST API access token via basic auth.
 */
export async function createOracleClient(
  baseUrl: string,
  username: string,
  password: string,
  identityDomain?: string
): Promise<AxiosInstance> {
  const authEndpoint = `${baseUrl}/api/auth/login`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (identityDomain) {
    headers['X-Identity-Domain'] = identityDomain;
  }

  const authResponse = await axios.post(
    authEndpoint,
    { username, password },
    { headers }
  );

  const token = authResponse.data.token || authResponse.data.access_token;

  return axios.create({
    baseURL: baseUrl,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });
}

/**
 * Apply transformation rules to a field value based on the mapping config.
 */
export function applyTransform(
  value: unknown,
  transformRule: Record<string, unknown> | null
): unknown {
  if (!transformRule || value === null || value === undefined) {
    return value;
  }

  // Simple value mapping
  const mapping = transformRule.mapping as Record<string, unknown> | undefined;
  if (mapping && typeof mapping[String(value)] !== 'undefined') {
    return mapping[String(value)];
  }

  // Concatenation rule: join array values with delimiter
  const concatFields = transformRule.concatFields as string[] | undefined;
  const delimiter = (transformRule.delimiter as string) || ' ';
  if (concatFields && Array.isArray(value)) {
    return value.join(delimiter);
  }

  // Multiplier rule
  const multiplier = transformRule.multiplier as number | undefined;
  if (multiplier !== undefined && typeof value === 'number') {
    return value * multiplier;
  }

  // Date format rule
  const dateFormat = transformRule.dateFormat as string | undefined;
  if (dateFormat && typeof value === 'string') {
    // Simple ISO date truncation for Oracle compatibility
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
  }

  return value;
}

/**
 * Transform source data to target format using field mappings.
 */
export function transformData(
  sourceData: Record<string, unknown>,
  mappings: FieldMappingRow[],
  sourceKey: 'shopify_field' | 'oracle_field',
  targetKey: 'shopify_field' | 'oracle_field'
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const mapping of mappings) {
    const sourceField = mapping[sourceKey] as string;
    const targetField = mapping[targetKey] as string;

    // Resolve nested field paths like "addresses[0].city"
    const value = getNestedValue(sourceData, sourceField);

    if (value === undefined && mapping.is_required) {
      logger.warn('Required field missing', {
        field: sourceField,
        entityType: mapping.entity_type,
      });
      continue;
    }

    if (value === undefined) {
      continue;
    }

    const transformedValue = applyTransform(value, mapping.transform_rule);
    setNestedValue(result, targetField, transformedValue);
  }

  return result;
}

/**
 * Get a nested value from an object using a dot-notation path.
 * Supports array index notation like "addresses[0].city".
 */
export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(/\.|(?=\[)/);
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }

    const arrayMatch = part.match(/^\[(\d+)\]$/);
    if (arrayMatch) {
      // Array index accessor like [0]
      if (Array.isArray(current)) {
        current = current[parseInt(arrayMatch[1], 10)];
      } else {
        return undefined;
      }
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Set a nested value in an object using a dot-notation path.
 */
export function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const parts = path.split('.');
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
    if (arrayMatch) {
      const [, key, indexStr] = arrayMatch;
      const index = parseInt(indexStr, 10);
      if (!current[key]) {
        current[key] = [];
      }
      const arr = current[key] as unknown[];
      if (!arr[index]) {
        arr[index] = {};
      }
      current = arr[index] as Record<string, unknown>;
    } else {
      if (!current[part]) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }
  }

  const lastPart = parts[parts.length - 1];
  current[lastPart] = value;
}

/**
 * Process a single record and log the result to the database.
 */
export async function processRecord(
  jobId: string,
  recordId: string,
  processor: () => Promise<{
    action: string;
    sourceData: Record<string, unknown> | null;
    targetData: Record<string, unknown> | null;
  }>
): Promise<RecordResult> {
  const result: RecordResult = {
    recordId,
    action: 'failed',
    sourceData: null,
    targetData: null,
    conflictDetected: false,
    conflictResolution: null,
    errorMessage: null,
  };

  try {
    const { action, sourceData, targetData } = await processor();
    result.action = action as RecordResult['action'];
    result.sourceData = sourceData;
    result.targetData = targetData;
  } catch (error) {
    result.action = 'failed';
    result.errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Record processing failed', {
      recordId,
      jobId,
      error: result.errorMessage,
    });
  }

  // Persist sync log entry
  try {
    await insertSyncLog({
      syncJobId: jobId,
      recordId: result.recordId,
      action: result.action,
      sourceData: result.sourceData,
      targetData: result.targetData,
      conflictDetected: result.conflictDetected,
      conflictResolution: result.conflictResolution,
      errorMessage: result.errorMessage,
    });
  } catch (logError) {
    logger.error('Failed to persist sync log', {
      recordId,
      jobId,
      error: logError instanceof Error ? logError.message : String(logError),
    });
  }

  return result;
}

/**
 * Update sync job progress after processing records.
 */
export async function updateJobProgress(
  jobId: string,
  processedCount: number,
  failedCount: number,
  errors: string[]
): Promise<void> {
  const status = failedCount > 0 && processedCount > 0
    ? 'partial'
    : failedCount > 0
    ? 'failed'
    : 'completed';

  await updateSyncJobProgress(jobId, {
    status,
    processed_records: processedCount,
    failed_records: failedCount,
    error_summary: errors.length > 0
      ? {
          errors: errors.slice(0, 100),
          totalErrors: errors.length,
          completedAt: new Date().toISOString(),
        }
      : null,
    completed_at: new Date(),
  });
}
