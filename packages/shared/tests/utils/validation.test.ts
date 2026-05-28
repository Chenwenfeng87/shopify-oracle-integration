import {
  validateShopifyDomain,
  validateOracleUrl,
  syncConfigSchema,
  fieldMappingSchema,
  transformRuleSchema,
  validateSyncConfig,
} from '@shared/utils/validation';

describe('validateShopifyDomain', () => {
  test('accepts valid domains', () => {
    expect(validateShopifyDomain('my-store.myshopify.com')).toBe(true);
    expect(validateShopifyDomain('test123.myshopify.com')).toBe(true);
    expect(validateShopifyDomain('a.myshopify.com')).toBe(true);
    expect(validateShopifyDomain('my-store-123.myshopify.com')).toBe(true);
  });

  test('rejects domains without myshopify.com', () => {
    expect(validateShopifyDomain('my-store.shopify.com')).toBe(false);
    expect(validateShopifyDomain('my-store.com')).toBe(false);
    expect(validateShopifyDomain('my-store.myshopify.io')).toBe(false);
  });

  test('rejects domains with special characters', () => {
    expect(validateShopifyDomain('my_store.myshopify.com')).toBe(false);
    expect(validateShopifyDomain('my store.myshopify.com')).toBe(false);
    expect(validateShopifyDomain('my$.store.myshopify.com')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(validateShopifyDomain('')).toBe(false);
  });

  test('rejects domains starting with hyphen', () => {
    expect(validateShopifyDomain('-store.myshopify.com')).toBe(false);
  });
});

describe('validateOracleUrl', () => {
  test('accepts valid URLs', () => {
    expect(validateOracleUrl('https://example.oracle.com')).toBe(true);
    expect(validateOracleUrl('https://my-instance.oraclecloud.com')).toBe(true);
    expect(validateOracleUrl('http://localhost:8080')).toBe(true);
    expect(validateOracleUrl('https://192.168.1.1/api')).toBe(true);
  });

  test('rejects invalid URLs', () => {
    expect(validateOracleUrl('')).toBe(false);
    expect(validateOracleUrl('not-a-url')).toBe(false);
    expect(validateOracleUrl('')).toBe(false);
  });

  test('rejects malformed URL strings', () => {
    expect(validateOracleUrl('ftp://invalid')).toBe(false);
  });
});

describe('syncConfigSchema', () => {
  const validConfig = {
    storeId: 'store-123',
    entityType: 'item' as const,
    frequency: 'scheduled' as const,
    isEnabled: true,
    batchSize: 100,
    conflictStrategy: 'source_wins' as const,
  };

  test('validates correct config', () => {
    const result = syncConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  test('rejects invalid entity type', () => {
    const result = syncConfigSchema.safeParse({
      ...validConfig,
      entityType: 'invalid_entity',
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid frequency', () => {
    const result = syncConfigSchema.safeParse({
      ...validConfig,
      frequency: 'hourly',
    });
    expect(result.success).toBe(false);
  });

  test('rejects batch size out of range (too low)', () => {
    const result = syncConfigSchema.safeParse({
      ...validConfig,
      batchSize: 0,
    });
    expect(result.success).toBe(false);
  });

  test('rejects batch size out of range (too high)', () => {
    const result = syncConfigSchema.safeParse({
      ...validConfig,
      batchSize: 501,
    });
    expect(result.success).toBe(false);
  });

  test('rejects batch size that is not an integer', () => {
    const result = syncConfigSchema.safeParse({
      ...validConfig,
      batchSize: 10.5,
    });
    expect(result.success).toBe(false);
  });

  test('rejects missing required fields', () => {
    const result = syncConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  test('rejects empty storeId', () => {
    const result = syncConfigSchema.safeParse({
      ...validConfig,
      storeId: '',
    });
    expect(result.success).toBe(false);
  });

  test('applies default values for optional fields', () => {
    const minimal = {
      storeId: 'store-1',
      entityType: 'customer' as const,
      frequency: 'real_time' as const,
    };
    const result = syncConfigSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isEnabled).toBe(true);
      expect(result.data.batchSize).toBe(100);
      expect(result.data.conflictStrategy).toBe('source_wins');
    }
  });

  test('accepts all valid entity types', () => {
    const entities = ['item', 'customer', 'order', 'price', 'inventory'] as const;
    for (const entity of entities) {
      const result = syncConfigSchema.safeParse({
        ...validConfig,
        entityType: entity,
      });
      expect(result.success).toBe(true);
    }
  });

  test('accepts all valid frequencies', () => {
    const frequencies = ['real_time', 'scheduled', 'manual'] as const;
    for (const freq of frequencies) {
      const result = syncConfigSchema.safeParse({
        ...validConfig,
        frequency: freq,
      });
      expect(result.success).toBe(true);
    }
  });

  test('accepts all valid conflict strategies', () => {
    const strategies = ['source_wins', 'target_wins', 'manual', 'merge'] as const;
    for (const strategy of strategies) {
      const result = syncConfigSchema.safeParse({
        ...validConfig,
        conflictStrategy: strategy,
      });
      expect(result.success).toBe(true);
    }
  });
});

describe('fieldMappingSchema', () => {
  const validMapping = {
    storeId: 'store-123',
    entityType: 'item' as const,
    direction: 'shopify_to_oracle' as const,
    shopifyField: 'title',
    oracleField: 'ItemDescription',
  };

  test('validates correct mapping', () => {
    const result = fieldMappingSchema.safeParse(validMapping);
    expect(result.success).toBe(true);
  });

  test('rejects invalid entity type', () => {
    const result = fieldMappingSchema.safeParse({
      ...validMapping,
      entityType: 'gadget',
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid direction', () => {
    const result = fieldMappingSchema.safeParse({
      ...validMapping,
      direction: 'sideways',
    });
    expect(result.success).toBe(false);
  });

  test('rejects empty shopifyField', () => {
    const result = fieldMappingSchema.safeParse({
      ...validMapping,
      shopifyField: '',
    });
    expect(result.success).toBe(false);
  });

  test('rejects empty oracleField', () => {
    const result = fieldMappingSchema.safeParse({
      ...validMapping,
      oracleField: '',
    });
    expect(result.success).toBe(false);
  });

  test('rejects missing required fields', () => {
    const result = fieldMappingSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  test('accepts mapping with transformRule', () => {
    const result = fieldMappingSchema.safeParse({
      ...validMapping,
      transformRule: { type: 'concat', config: { fields: ['first', 'last'], separator: ' ' } },
    });
    expect(result.success).toBe(true);
  });

  test('accepts mapping with null transformRule', () => {
    const result = fieldMappingSchema.safeParse({
      ...validMapping,
      transformRule: null,
    });
    expect(result.success).toBe(true);
  });

  test('applies default values', () => {
    const result = fieldMappingSchema.safeParse(validMapping);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.transformRule).toBeNull();
      expect(result.data.isRequired).toBe(false);
    }
  });
});

describe('transformRuleSchema', () => {
  test('validates direct rule type', () => {
    const result = transformRuleSchema.safeParse({
      type: 'direct',
      config: {},
    });
    expect(result.success).toBe(true);
  });

  test('validates concat rule type', () => {
    const result = transformRuleSchema.safeParse({
      type: 'concat',
      config: { fields: ['first', 'last'], separator: ' ' },
    });
    expect(result.success).toBe(true);
  });

  test('validates split rule type', () => {
    const result = transformRuleSchema.safeParse({
      type: 'split',
      config: { separator: ',', index: 1 },
    });
    expect(result.success).toBe(true);
  });

  test('validates formula rule type', () => {
    const result = transformRuleSchema.safeParse({
      type: 'formula',
      config: { factor: 1.08 },
    });
    expect(result.success).toBe(true);
  });

  test('validates lookup rule type', () => {
    const result = transformRuleSchema.safeParse({
      type: 'lookup',
      config: { mapping: { active: 'Active' } },
    });
    expect(result.success).toBe(true);
  });

  test('validates date_format rule type', () => {
    const result = transformRuleSchema.safeParse({
      type: 'date_format',
      config: { targetFormat: 'iso' },
    });
    expect(result.success).toBe(true);
  });

  test('validates custom rule type', () => {
    const result = transformRuleSchema.safeParse({
      type: 'custom',
      config: { functionBody: 'return value.toUpperCase();' },
    });
    expect(result.success).toBe(true);
  });

  test('rejects invalid rule type', () => {
    const result = transformRuleSchema.safeParse({
      type: 'invalid_type',
      config: {},
    });
    expect(result.success).toBe(false);
  });

  test('rejects missing config', () => {
    const result = transformRuleSchema.safeParse({
      type: 'direct',
    });
    expect(result.success).toBe(false);
  });

  test('rejects null type', () => {
    const result = transformRuleSchema.safeParse({
      type: null,
      config: {},
    });
    expect(result.success).toBe(false);
  });
});

describe('validateSyncConfig', () => {
  test('returns parsed config for valid input', () => {
    const config = {
      storeId: 'store-123',
      entityType: 'item' as const,
      frequency: 'scheduled' as const,
    };
    const result = validateSyncConfig(config);
    expect(result).toHaveProperty('storeId', 'store-123');
    expect(result).toHaveProperty('isEnabled', true);
    expect(result).toHaveProperty('batchSize', 100);
  });

  test('throws ZodError for invalid input', () => {
    expect(() => validateSyncConfig({})).toThrow();
  });
});
