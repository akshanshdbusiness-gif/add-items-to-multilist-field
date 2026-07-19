import { describe, expect, it } from 'vitest';
import {
  buildGetItemsByIdQuery,
  buildUpdateFieldsMutation,
  extractItemsFromBatchResult,
  type ItemSummary,
} from './queries';

describe('buildGetItemsByIdQuery', () => {
  it('builds one aliased field and variable declaration per id', () => {
    const { query, variables } = buildGetItemsByIdQuery(['{A}', '{B}', '{C}'], 'master');

    expect(query).toContain('item0: item(where: { itemId: $itemId0, database: $database })');
    expect(query).toContain('item1: item(where: { itemId: $itemId1, database: $database })');
    expect(query).toContain('item2: item(where: { itemId: $itemId2, database: $database })');
    expect(query).toContain('$itemId0: ID!');
    expect(query).toContain('$itemId2: ID!');

    expect(variables).toEqual({
      database: 'master',
      itemId0: '{A}',
      itemId1: '{B}',
      itemId2: '{C}',
    });
  });

  it('produces an empty alias list for zero ids without breaking the query shape', () => {
    const { query, variables } = buildGetItemsByIdQuery([], 'master');
    expect(query).toContain('query GetItemsById($database: String!, )');
    expect(variables).toEqual({ database: 'master' });
  });
});

describe('buildUpdateFieldsMutation', () => {
  const baseParams = {
    itemId: '{ITEM}',
    database: 'master',
    language: 'en',
  };

  it('passes a numeric version through unchanged', () => {
    const { variables } = buildUpdateFieldsMutation({
      ...baseParams,
      version: 3,
      fields: [{ name: 'Categories', value: '{A}|{B}' }],
    });
    expect(variables.version).toBe(3);
    expect(typeof variables.version).toBe('number');
  });

  it('coerces a string version to a number', () => {
    // Regression: the Marketplace SDK's runtime payload for itemVersion has
    // been observed to not match its declared TypeScript `number` type,
    // which the Authoring API's Int scalar rejects outright (HotChocolate's
    // "Unable to convert type from `String` to `Nullable`1`") rather than
    // coercing on its own.
    const { variables } = buildUpdateFieldsMutation({
      ...baseParams,
      version: '3' as unknown as number,
      fields: [{ name: 'Categories', value: '{A}|{B}' }],
    });
    expect(variables.version).toBe(3);
    expect(typeof variables.version).toBe('number');
  });

  it('builds one aliased field/value variable pair per field, in order', () => {
    const { query, variables } = buildUpdateFieldsMutation({
      ...baseParams,
      version: 1,
      fields: [
        { name: 'Categories', value: '{A}|{B}' },
        { name: '__Display Name', value: 'Fitness' },
      ],
    });

    expect(query).toContain('$fieldName0: String!, $fieldValue0: String!');
    expect(query).toContain('$fieldName1: String!, $fieldValue1: String!');
    expect(query).toContain(
      'fields: [{ name: $fieldName0, value: $fieldValue0, reset: false }, ' +
        '{ name: $fieldName1, value: $fieldValue1, reset: false }]',
    );
    expect(variables).toMatchObject({
      fieldName0: 'Categories',
      fieldValue0: '{A}|{B}',
      fieldName1: '__Display Name',
      fieldValue1: 'Fitness',
    });
  });
});

describe('extractItemsFromBatchResult', () => {
  const item0: ItemSummary = {
    itemId: '{A}',
    name: 'Card A',
    path: '/sitecore/content/Site/Data/card-a',
    templateId: '{TEMPLATE}',
    parent: { itemId: '{PARENT}', path: '/sitecore/content/Site/Data' },
  };

  it('collects aliased results in order', () => {
    const result = extractItemsFromBatchResult({ item0, item1: null }, 2);
    expect(result).toEqual([item0]);
  });

  it('returns an empty array when nothing was found', () => {
    expect(extractItemsFromBatchResult({ item0: null }, 1)).toEqual([]);
  });
});
