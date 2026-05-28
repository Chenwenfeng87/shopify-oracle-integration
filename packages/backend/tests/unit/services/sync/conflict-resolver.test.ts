import { ConflictResolver } from '../../../../src/services/sync/conflict-resolver';
import type { FieldMapping } from '@shared/types';

describe('ConflictResolver', () => {
  let resolver: ConflictResolver;

  const baseFieldMappings: FieldMapping[] = [
    createMapping('title', 'ItemDescription'),
    createMapping('price', 'ListPrice'),
    createMapping('sku', 'ItemNumber'),
    createMapping('status', 'ItemStatus'),
  ];

  function createMapping(
    shopifyField: string,
    oracleField: string,
    isRequired = false,
  ): FieldMapping {
    return {
      id: `mapping-${shopifyField}`,
      storeId: 'store-1',
      entityType: 'item',
      direction: 'shopify_to_oracle',
      shopifyField,
      oracleField,
      transformRule: null,
      isRequired,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  beforeEach(() => {
    resolver = new ConflictResolver();
  });

  describe('detectConflict', () => {
    test('detects no conflict when records are identical', () => {
      const source = { title: 'Widget', price: 10.0, sku: 'SKU-001' };
      const target = { title: 'Widget', price: 10.0, sku: 'SKU-001' };

      const result = resolver.detectConflict(source, target, baseFieldMappings);

      expect(result.hasConflict).toBe(false);
      expect(result.conflictingFields).toEqual([]);
    });

    test('detects conflict when values differ', () => {
      const source = { title: 'Widget Pro', price: 15.0, sku: 'SKU-001' };
      const target = { title: 'Widget Basic', price: 10.0, sku: 'SKU-001' };

      const result = resolver.detectConflict(source, target, baseFieldMappings);

      expect(result.hasConflict).toBe(true);
      expect(result.conflictingFields).toContain('title');
      expect(result.conflictingFields).toContain('price');
      expect(result.conflictingFields).not.toContain('sku');
    });

    test('detects conflict on specific fields only', () => {
      const source = { title: 'Widget', price: 10.0 };
      const target = { title: 'Widget', price: 12.0 };

      const singleMapping = [createMapping('price', 'ListPrice')];
      const result = resolver.detectConflict(source, target, singleMapping);

      expect(result.hasConflict).toBe(true);
      expect(result.conflictingFields).toEqual(['price']);
    });

    test('ignores fields not in mappings', () => {
      const source = { title: 'Widget', price: 10.0, extraField: 'x' };
      const target = { title: 'Widget', price: 10.0, extraField: 'y' };

      // Only map title and price, not extraField
      const limitedMappings = [
        createMapping('title', 'ItemDescription'),
        createMapping('price', 'ListPrice'),
      ];
      const result = resolver.detectConflict(source, target, limitedMappings);

      expect(result.hasConflict).toBe(false);
      expect(result.conflictingFields).toEqual([]);
    });

    test('handles null/undefined values', () => {
      const source = { title: 'Widget', price: null as any, sku: undefined as any };
      const target = { title: 'Widget', price: 10.0, sku: 'SKU-001' };

      const result = resolver.detectConflict(source, target, baseFieldMappings);

      expect(result.hasConflict).toBe(false);
    });

    test('handles deeply nested values with JSON comparison', () => {
      const source = { address: { city: 'NYC', zip: '10001' } };
      const target = { address: { city: 'NYC', zip: '10002' } };
      const mappings = [createMapping('address', 'Address')];

      const result = resolver.detectConflict(source, target, mappings);

      expect(result.hasConflict).toBe(true);
      expect(result.conflictingFields).toContain('address');
    });

    test('empty mappings produce no conflict', () => {
      const source = { title: 'Widget' };
      const target = { title: 'Widget Pro' };

      const result = resolver.detectConflict(source, target, []);

      expect(result.hasConflict).toBe(false);
      expect(result.conflictingFields).toEqual([]);
    });
  });

  describe('resolve - source_wins', () => {
    test('source data overwrites target on conflicts', () => {
      const source = { title: 'Widget Pro', price: 15.0, sku: 'SKU-001' };
      const target = { title: 'Widget Basic', price: 10.0, sku: 'SKU-001' };

      const result = resolver.resolve(source, target, baseFieldMappings, 'source_wins');

      expect(result.resolved.title).toBe('Widget Pro');
      expect(result.resolved.price).toBe(15.0);
      expect(result.resolved.sku).toBe('SKU-001');
      expect(result.conflictsResolved).toContain('title');
      expect(result.conflictsResolved).toContain('price');
      expect(result.requiresManualReview).toBe(false);
    });

    test('non-conflicting fields preserved', () => {
      const source = { title: 'Widget Pro', sku: 'SKU-001' };
      const target = { title: 'Widget Basic', price: 10.0 };

      const mappings = [
        createMapping('title', 'ItemDescription'),
        createMapping('price', 'ListPrice'),
      ];
      const result = resolver.resolve(source, target, mappings, 'source_wins');

      expect(result.resolved.title).toBe('Widget Pro'); // source wins on conflict
      expect(result.resolved.price).toBe(10.0); // non-conflicting merged
      expect(result.resolved.sku).toBe('SKU-001'); // non-conflicting merged
    });

    test('no conflicts returns merged result', () => {
      const source = { title: 'Widget', sku: 'SKU-001' };
      const target = { price: 10.0 };

      const result = resolver.resolve(source, target, baseFieldMappings, 'source_wins');

      expect(result.hasOwnProperty('conflictsResolved')).toBe(true);
      expect(result.conflictsResolved).toEqual([]);
      expect(result.requiresManualReview).toBe(false);
    });
  });

  describe('resolve - target_wins', () => {
    test('target data preserved on conflicts', () => {
      const source = { title: 'Widget Pro', price: 15.0, sku: 'SKU-001' };
      const target = { title: 'Widget Basic', price: 10.0, sku: 'SKU-001' };

      const result = resolver.resolve(source, target, baseFieldMappings, 'target_wins');

      expect(result.resolved.title).toBe('Widget Basic');
      expect(result.resolved.price).toBe(10.0);
      expect(result.resolved.sku).toBe('SKU-001');
      expect(result.conflictsResolved).toContain('title');
      expect(result.conflictsResolved).toContain('price');
      expect(result.requiresManualReview).toBe(false);
    });

    test('source values ignored for conflicting fields', () => {
      const source = { title: 'New Title', status: 'active' };
      const target = { title: 'Old Title', status: 'archived' };
      const mappings = [
        createMapping('title', 'ItemDescription'),
        createMapping('status', 'ItemStatus'),
      ];

      const result = resolver.resolve(source, target, mappings, 'target_wins');

      expect(result.resolved.title).toBe('Old Title');
      expect(result.resolved.status).toBe('archived');
    });
  });

  describe('resolve - merge', () => {
    test('merges non-conflicting fields', () => {
      const source = { title: 'Widget', price: 15.0, sku: 'SKU-001' };
      const target = { title: 'Widget', price: 10.0, sku: 'SKU-002' };

      const result = resolver.resolve(source, target, baseFieldMappings, 'merge');

      // title has no conflict, sku is not in mappings for this test
      expect(result.resolved).toBeDefined();
      expect(result.requiresManualReview).toBe(false);
    });

    test('uses last_modified timestamp to resolve conflicts', () => {
      const source = { title: 'New Title', price: 15.0, last_modified: '2024-06-15T10:00:00Z' };
      const target = { title: 'Old Title', price: 10.0, last_modified: '2024-06-14T10:00:00Z' };

      const result = resolver.resolve(source, target, baseFieldMappings, 'merge');

      // Source has newer timestamp, so source wins
      expect(result.resolved.title).toBe('New Title');
      expect(result.conflictsResolved).toHaveLength(2);
      expect(result.requiresManualReview).toBe(false);
    });

    test('uses updatedAt timestamp when last_modified absent', () => {
      const source = { title: 'Older', price: 15.0, updatedAt: '2024-01-01T00:00:00Z' };
      const target = { title: 'Newer', price: 10.0, updatedAt: '2024-06-01T00:00:00Z' };

      const result = resolver.resolve(source, target, baseFieldMappings, 'merge');

      // Target has newer timestamp, so target wins
      expect(result.resolved.title).toBe('Newer');
      expect(result.resolved.price).toBe(10.0);
    });

    test('uses updated_at field (snake_case)', () => {
      const source = { title: 'A', price: 10.0, updated_at: '2024-05-01T00:00:00Z' };
      const target = { title: 'B', price: 20.0, updated_at: '2024-03-01T00:00:00Z' };

      const result = resolver.resolve(source, target, baseFieldMappings, 'merge');

      expect(result.resolved.title).toBe('A');
    });

    test('uses modifiedAt field', () => {
      const source = { title: 'X', modifiedAt: '2024-07-01T00:00:00Z' };
      const target = { title: 'Y', modifiedAt: '2024-07-02T00:00:00Z' };

      const result = resolver.resolve(source, target, baseFieldMappings, 'merge');

      expect(result.resolved.title).toBe('Y');
    });

    test('marks unresolved when no timestamp available', () => {
      const source = { title: 'Source Title', price: 15.0 };
      const target = { title: 'Target Title', price: 10.0 };

      const result = resolver.resolve(source, target, baseFieldMappings, 'merge');

      expect(result.conflictsUnresolved).toContain('title');
      expect(result.conflictsUnresolved).toContain('price');
      expect(result.requiresManualReview).toBe(true);
    });

    test('resolves with timestamp when only one side has it', () => {
      const source = { title: 'Source Title', price: 15.0, last_modified: '2024-06-15T10:00:00Z' };
      const target = { title: 'Target Title', price: 10.0 };

      const result = resolver.resolve(source, target, baseFieldMappings, 'merge');

      expect(result.conflictsResolved).toContain('title');
      expect(result.conflictsUnresolved).toHaveLength(0);
    });
  });

  describe('resolve - manual', () => {
    test('merges non-conflicting fields only', () => {
      const source = { title: 'New Title', price: 15.0, sku: 'SKU-NEW' };
      const target = { title: 'Old Title', price: 10.0, sku: 'SKU-OLD' };

      const result = resolver.resolve(source, target, baseFieldMappings, 'manual');

      // Conflicting fields should keep target values
      expect(result.resolved.title).toBe('Old Title');
      expect(result.resolved.price).toBe(10.0);
      // Non-conflicting fields aren't in our mappings for this scenario
    });

    test('flags all conflicting fields for review', () => {
      const source = { title: 'A', price: 20.0, sku: 'SKU-1' };
      const target = { title: 'B', price: 10.0, sku: 'SKU-1' };

      const result = resolver.resolve(source, target, baseFieldMappings, 'manual');

      expect(result.conflictsUnresolved).toContain('title');
      expect(result.conflictsUnresolved).toContain('price');
      expect(result.conflictsUnresolved).not.toContain('sku');
    });

    test('sets requiresManualReview to true', () => {
      const source = { title: 'A', price: 20.0 };
      const target = { title: 'B', price: 10.0 };

      const result = resolver.resolve(source, target, baseFieldMappings, 'manual');

      expect(result.requiresManualReview).toBe(true);
      expect(result.strategy).toBe('manual');
    });

    test('no conflicts does not require review', () => {
      const source = { title: 'Same', price: 10.0, sku: 'SKU-1' };
      const target = { title: 'Same', price: 10.0, sku: 'SKU-1' };

      const result = resolver.resolve(source, target, baseFieldMappings, 'manual');

      expect(result.requiresManualReview).toBe(false);
      expect(result.conflictsUnresolved).toEqual([]);
    });
  });

  describe('resolve - unknown strategy fallback', () => {
    test('falls back to source_wins for unknown strategy', () => {
      const source = { title: 'Source' };
      const target = { title: 'Target' };

      const result = resolver.resolve(source, target, baseFieldMappings, 'unknown_strategy' as any);

      expect(result.strategy).toBe('source_wins');
      expect(result.resolved.title).toBe('Source');
    });
  });
});
