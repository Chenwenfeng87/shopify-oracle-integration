import {
  getNestedValue,
  setNestedValue,
  mapRecord,
  applyTransform,
} from '@shared/utils/field-mapper';
import type { FieldMappingDef } from '@shared/utils/field-mapper';

describe('getNestedValue', () => {
  test('gets simple property', () => {
    const obj = { name: 'Widget', price: 19.99 };
    expect(getNestedValue(obj, 'name')).toBe('Widget');
    expect(getNestedValue(obj, 'price')).toBe(19.99);
  });

  test('gets deeply nested property (dot notation)', () => {
    const obj = {
      a: {
        b: {
          c: 'deep-value',
        },
      },
    };
    expect(getNestedValue(obj, 'a.b.c')).toBe('deep-value');
  });

  test('returns undefined for missing path', () => {
    const obj = { a: { b: 42 } };
    expect(getNestedValue(obj, 'a.b.c')).toBeUndefined();
    expect(getNestedValue(obj, 'x.y.z')).toBeUndefined();
  });

  test('handles array indices in path', () => {
    const obj = { items: [{ name: 'First' }, { name: 'Second' }] };
    expect(getNestedValue(obj, 'items.0.name')).toBe('First');
    expect(getNestedValue(obj, 'items.1.name')).toBe('Second');
  });

  test('returns undefined when encountering null in path', () => {
    const obj = { a: null };
    expect(getNestedValue(obj, 'a.b')).toBeUndefined();
  });

  test('returns undefined when encountering undefined in path', () => {
    const obj = { a: { b: undefined } };
    expect(getNestedValue(obj, 'a.b')).toBeUndefined();
  });
});

describe('setNestedValue', () => {
  test('sets simple property', () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, 'name', 'Widget');
    expect(obj.name).toBe('Widget');
  });

  test('sets nested property creating intermediate objects', () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, 'a.b.c', 42);
    expect(obj).toEqual({ a: { b: { c: 42 } } });
  });

  test('creates arrays when next segment is numeric', () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, 'items.0.name', 'First');
    expect(Array.isArray(obj.items)).toBe(true);
    expect((obj.items as unknown[])[0]).toEqual({ name: 'First' });
  });

  test('overwrites existing value', () => {
    const obj: Record<string, unknown> = { a: { b: 'old' } };
    setNestedValue(obj, 'a.b', 'new');
    expect(obj.a).toEqual({ b: 'new' });
  });

  test('handles deep nesting with mixed arrays and objects', () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, 'data.0.addresses.0.city', 'New York');
    expect(obj).toEqual({
      data: [{ addresses: [{ city: 'New York' }] }],
    });
  });
});

describe('mapRecord', () => {
  const baseMappings: FieldMappingDef[] = [
    { shopifyField: 'title', oracleField: 'ItemDescription' },
    { shopifyField: 'sku', oracleField: 'ItemNumber' },
    { shopifyField: 'price', oracleField: 'ListPrice' },
  ];

  test('maps shopify -> oracle direction correctly', () => {
    const source = {
      title: 'Widget Pro',
      sku: 'WP-001',
      price: 29.99,
    };

    const result = mapRecord(source, baseMappings, false);

    expect(result).toEqual({
      ItemDescription: 'Widget Pro',
      ItemNumber: 'WP-001',
      ListPrice: 29.99,
    });
  });

  test('maps oracle -> shopify direction correctly (reverse)', () => {
    const source = {
      ItemDescription: 'Widget Pro',
      ItemNumber: 'WP-001',
      ListPrice: 29.99,
    };

    const result = mapRecord(source, baseMappings, true);

    expect(result).toEqual({
      title: 'Widget Pro',
      sku: 'WP-001',
      price: 29.99,
    });
  });

  test('handles missing source fields (excludes from output)', () => {
    const source = {
      title: 'Widget Pro',
    };

    const result = mapRecord(source, baseMappings, false);

    expect(result).toEqual({
      ItemDescription: 'Widget Pro',
    });
    expect(result).not.toHaveProperty('ItemNumber');
    expect(result).not.toHaveProperty('ListPrice');
  });

  test('handles empty mappings array', () => {
    const source = { title: 'Widget' };
    const result = mapRecord(source, []);
    expect(result).toEqual({});
  });

  test('handles null/undefined transform rules', () => {
    const mappings: FieldMappingDef[] = [
      { shopifyField: 'title', oracleField: 'ItemDescription', transformRule: null },
      { shopifyField: 'sku', oracleField: 'ItemNumber', transformRule: undefined as any },
    ];
    const source = { title: 'Widget', sku: 'SKU-001' };
    const result = mapRecord(source, mappings);
    expect(result).toEqual({
      ItemDescription: 'Widget',
      ItemNumber: 'SKU-001',
    });
  });

  test('applies transform rules during mapping', () => {
    const mappings: FieldMappingDef[] = [
      { shopifyField: 'first_name', oracleField: 'PartyName', transformRule: { type: 'concat', config: { fields: ['first_name', 'last_name'], separator: ' ' } } },
    ];
    const source = { first_name: 'John', last_name: 'Doe' };
    const result = mapRecord(source, mappings);
    expect(result).toEqual({ PartyName: 'John Doe' });
  });
});

describe('applyTransform', () => {
  test('direct mapping', () => {
    const rule = { type: 'direct' as const, config: {} };
    expect(applyTransform(42, rule)).toBe(42);
    expect(applyTransform('hello', rule)).toBe('hello');
    expect(applyTransform(null, rule)).toBeNull();
  });

  test('concat transform with separator', () => {
    const rule = {
      type: 'concat' as const,
      config: { fields: ['first', 'last'], separator: ', ' },
    };
    const value = { first: 'John', last: 'Doe' };
    expect(applyTransform(value, rule)).toBe('John, Doe');
  });

  test('concat transform uses default space separator', () => {
    const rule = {
      type: 'concat' as const,
      config: { fields: ['first', 'last'] },
    };
    const value = { first: 'John', last: 'Doe' };
    expect(applyTransform(value, rule)).toBe('John Doe');
  });

  test('concat transform returns value when fields is empty', () => {
    const rule = {
      type: 'concat' as const,
      config: { fields: [] },
    };
    expect(applyTransform('fallback', rule)).toBe('fallback');
  });

  test('split transform', () => {
    const rule = {
      type: 'split' as const,
      config: { separator: ',', index: 1 },
    };
    expect(applyTransform('apple,banana,cherry', rule)).toBe('banana');
  });

  test('split transform returns empty string for missing index', () => {
    const rule = {
      type: 'split' as const,
      config: { separator: ',', index: 5 },
    };
    expect(applyTransform('a,b,c', rule)).toBe('');
  });

  test('split transform uses defaults for separator and index', () => {
    const rule = {
      type: 'split' as const,
      config: {},
    };
    expect(applyTransform('hello,world', rule)).toBe('hello');
  });

  test('formula transform (basic math)', () => {
    const rule = {
      type: 'formula' as const,
      config: { factor: 1.08 },
    };
    expect(applyTransform(100, rule)).toBe(108);
  });

  test('formula transform converts string number', () => {
    const rule = {
      type: 'formula' as const,
      config: { factor: 2 },
    };
    expect(applyTransform('50', rule)).toBe(100);
  });

  test('formula transform returns original value for non-numeric input', () => {
    const rule = {
      type: 'formula' as const,
      config: { factor: 2 },
    };
    expect(applyTransform('abc', rule)).toBe('abc');
  });

  test('formula transform uses factor of 1 when not specified', () => {
    const rule = {
      type: 'formula' as const,
      config: {},
    };
    expect(applyTransform(50, rule)).toBe(50);
  });

  test('lookup transform (value mapping table)', () => {
    const rule = {
      type: 'lookup' as const,
      config: {
        mapping: { active: 'Active', archived: 'Inactive', draft: 'Draft' },
      },
    };
    expect(applyTransform('active', rule)).toBe('Active');
    expect(applyTransform('archived', rule)).toBe('Inactive');
  });

  test('lookup transform returns original for unmapped value', () => {
    const rule = {
      type: 'lookup' as const,
      config: {
        mapping: { active: 'Active' },
      },
    };
    expect(applyTransform('unknown', rule)).toBe('unknown');
  });

  test('lookup transform returns original when mapping is missing', () => {
    const rule = {
      type: 'lookup' as const,
      config: {},
    };
    expect(applyTransform('active', rule)).toBe('active');
  });

  test('date_format transform converts to ISO string', () => {
    const rule = {
      type: 'date_format' as const,
      config: {},
    };
    const result = applyTransform('2024-01-15T10:30:00Z', rule) as string;
    expect(result).toContain('2024');
  });

  test('date_format transform with targetFormat date', () => {
    const rule = {
      type: 'date_format' as const,
      config: { targetFormat: 'date' },
    };
    const result = applyTransform('2024-01-15T10:30:00Z', rule);
    expect(result).toBe('2024-01-15');
  });

  test('date_format transform with targetFormat timestamp', () => {
    const rule = {
      type: 'date_format' as const,
      config: { targetFormat: 'timestamp' },
    };
    const result = applyTransform('2024-01-15T10:30:00Z', rule);
    expect(typeof result).toBe('number');
    expect(result as number).toBeGreaterThan(0);
  });

  test('date_format returns original value for invalid date', () => {
    const rule = {
      type: 'date_format' as const,
      config: { targetFormat: 'iso' },
    };
    expect(applyTransform('not-a-date', rule)).toBe('not-a-date');
  });

  test('date_format handles Date objects', () => {
    const rule = {
      type: 'date_format' as const,
      config: { targetFormat: 'date' },
    };
    const date = new Date('2024-06-15T00:00:00Z');
    const result = applyTransform(date, rule);
    expect(result).toBe('2024-06-15');
  });

  test('date_format returns value when no sourceFormat and no targetFormat', () => {
    const rule = {
      type: 'date_format' as const,
      config: {},
    };
    const original = 'some-value';
    expect(applyTransform(original, rule)).toBe(original);
  });

  test('custom transform (passthrough)', () => {
    const rule = { type: 'custom' as const, config: { functionBody: 'return value;' } };
    expect(applyTransform({ foo: 'bar' }, rule)).toEqual({ foo: 'bar' });
    expect(applyTransform(42, rule)).toBe(42);
    expect(applyTransform(null, rule)).toBeNull();
  });

  test('unknown transform type returns value unchanged', () => {
    const rule = { type: 'unknown_type' as any, config: {} };
    expect(applyTransform(42, rule)).toBe(42);
  });
});
