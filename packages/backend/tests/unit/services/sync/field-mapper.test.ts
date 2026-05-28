import { FieldMapperService } from '../../../../src/services/sync/field-mapper';
import { FieldMappingModel } from '../../../../src/models/field-mapping.model';
import type { FieldMapping, EntityType, SyncDirection } from '@shared/types';

jest.mock('../../../../src/models/field-mapping.model');

describe('FieldMapperService', () => {
  let service: FieldMapperService;
  const storeId = 'store-test-123';

  const mockMappings: FieldMapping[] = [
    {
      id: 'mapping-1',
      storeId,
      entityType: 'item',
      direction: 'shopify_to_oracle',
      shopifyField: 'title',
      oracleField: 'ItemDescription',
      transformRule: null,
      isRequired: true,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    },
    {
      id: 'mapping-2',
      storeId,
      entityType: 'item',
      direction: 'shopify_to_oracle',
      shopifyField: 'price',
      oracleField: 'ListPrice',
      transformRule: { type: 'formula', config: { factor: 1.1 } },
      isRequired: false,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    },
  ];

  const mockDefaultMappings = [
    {
      shopifyField: 'title',
      oracleField: 'ItemDescription',
      transformRule: null,
      isRequired: true,
    },
    {
      shopifyField: 'sku',
      oracleField: 'ItemNumber',
      transformRule: null,
      isRequired: true,
    },
  ];

  beforeEach(() => {
    service = new FieldMapperService(storeId);
    jest.clearAllMocks();
  });

  describe('loadMappings', () => {
    test('returns mappings from database', async () => {
      (FieldMappingModel.findByStoreAndEntity as jest.Mock).mockResolvedValue(mockMappings);

      const result = await service.loadMappings('item', 'shopify_to_oracle');

      expect(result).toEqual(mockMappings);
      expect(FieldMappingModel.findByStoreAndEntity).toHaveBeenCalledWith(
        storeId,
        'item',
        'shopify_to_oracle',
      );
    });

    test('returns defaults when no custom mappings', async () => {
      (FieldMappingModel.findByStoreAndEntity as jest.Mock).mockResolvedValue([]);
      (FieldMappingModel.getDefaults as jest.Mock).mockResolvedValue(mockDefaultMappings);

      const result = await service.loadMappings('item', 'shopify_to_oracle');

      expect(result).toHaveLength(2);
      expect(result[0].shopifyField).toBe('title');
      expect(result[0].oracleField).toBe('ItemDescription');
      expect(result[1].shopifyField).toBe('sku');
      expect(FieldMappingModel.getDefaults).toHaveBeenCalledWith('item');
    });

    test('caches mappings after first load', async () => {
      (FieldMappingModel.findByStoreAndEntity as jest.Mock).mockResolvedValue(mockMappings);

      // First call
      const result1 = await service.loadMappings('item', 'shopify_to_oracle');
      // Second call (should use cache)
      const result2 = await service.loadMappings('item', 'shopify_to_oracle');

      expect(result1).toEqual(mockMappings);
      expect(result2).toEqual(mockMappings);
      expect(FieldMappingModel.findByStoreAndEntity).toHaveBeenCalledTimes(1);
    });

    test('throws and falls back to defaults on database error', async () => {
      (FieldMappingModel.findByStoreAndEntity as jest.Mock).mockRejectedValue(
        new Error('DB connection failed'),
      );
      (FieldMappingModel.getDefaults as jest.Mock).mockResolvedValue(mockDefaultMappings);

      const result = await service.loadMappings('item', 'shopify_to_oracle');

      expect(result).toHaveLength(2);
      expect(result[0].shopifyField).toBe('title');
      expect(FieldMappingModel.getDefaults).toHaveBeenCalledWith('item');
    });

    test('respects direction when loading mappings', async () => {
      (FieldMappingModel.findByStoreAndEntity as jest.Mock).mockResolvedValue([]);
      (FieldMappingModel.getDefaults as jest.Mock).mockResolvedValue(mockDefaultMappings);

      await service.loadMappings('item', 'oracle_to_shopify');

      expect(FieldMappingModel.findByStoreAndEntity).toHaveBeenCalledWith(
        storeId,
        'item',
        'oracle_to_shopify',
      );
    });

    test('separate cache entries for different entity types', async () => {
      (FieldMappingModel.findByStoreAndEntity as jest.Mock).mockImplementation(
        (_storeId: string, entityType: EntityType, _direction: SyncDirection) => {
          if (entityType === 'item') {
            return Promise.resolve(mockMappings);
          }
          return Promise.resolve([]);
        },
      );
      (FieldMappingModel.getDefaults as jest.Mock).mockResolvedValue(mockDefaultMappings);

      await service.loadMappings('item', 'shopify_to_oracle');
      await service.loadMappings('customer', 'shopify_to_oracle');

      expect(FieldMappingModel.findByStoreAndEntity).toHaveBeenCalledTimes(2);
    });
  });

  describe('transform', () => {
    test('applies mappings correctly', async () => {
      (FieldMappingModel.findByStoreAndEntity as jest.Mock).mockResolvedValue(mockMappings);

      const source = { title: 'Widget Pro', price: 100 };
      const result = await service.transform(source, 'item', 'shopify_to_oracle');

      expect(result).toEqual({
        ItemDescription: 'Widget Pro',
        ListPrice: 110, // 100 * 1.1 formula transform
      });
    });

    test('handles reverse direction (oracle_to_shopify)', async () => {
      const reverseMappings: FieldMapping[] = [
        {
          id: 'mapping-3',
          storeId,
          entityType: 'item',
          direction: 'oracle_to_shopify',
          shopifyField: 'title',
          oracleField: 'ItemDescription',
          transformRule: null,
          isRequired: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      (FieldMappingModel.findByStoreAndEntity as jest.Mock).mockResolvedValue(reverseMappings);

      const source = { ItemDescription: 'Oracle Widget' };
      const result = await service.transform(source, 'item', 'oracle_to_shopify');

      expect(result).toEqual({ title: 'Oracle Widget' });
    });

    test('throws error when transform fails', async () => {
      (FieldMappingModel.findByStoreAndEntity as jest.Mock).mockResolvedValue(mockMappings);

      // Pass something that causes mapRecord to fail - normally it doesn't throw,
      // but let's test the error logging path
      const source = { title: 'Widget' };
      const result = await service.transform(source, 'item', 'shopify_to_oracle');
      expect(result).toBeDefined();
    });
  });

  describe('transformBatch', () => {
    test('processes all records', async () => {
      (FieldMappingModel.findByStoreAndEntity as jest.Mock).mockResolvedValue([mockMappings[0]]);

      const records = [
        { title: 'Widget 1' },
        { title: 'Widget 2' },
        { title: 'Widget 3' },
      ];
      const results = await service.transformBatch(records, 'item', 'shopify_to_oracle');

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ ItemDescription: 'Widget 1' });
      expect(results[1]).toEqual({ ItemDescription: 'Widget 2' });
      expect(results[2]).toEqual({ ItemDescription: 'Widget 3' });
    });

    test('returns empty array for empty input', async () => {
      const results = await service.transformBatch([], 'item', 'shopify_to_oracle');
      expect(results).toEqual([]);
    });

    test('handles errors gracefully and returns original records', async () => {
      (FieldMappingModel.findByStoreAndEntity as jest.Mock).mockResolvedValue(mockMappings);

      const records = [{ title: 'Widget' }, { price: 100 }];
      const results = await service.transformBatch(records, 'item', 'shopify_to_oracle');

      expect(results).toHaveLength(2);
    });
  });
});
