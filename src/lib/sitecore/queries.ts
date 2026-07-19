/**
 * GraphQL query/mutation builders for the Sitecore Authoring & Management API
 * (`/sitecore/api/authoring/graphql/v1/`). This API models fields as raw
 * name/value pairs (`fields(ownFields: true) { nodes { name value } }`) —
 * unlike the Experience Edge/Layout Service API, it does not resolve
 * Multilist/TreelistEx values into typed `targetItems`. Multilist raw values
 * (pipe-delimited GUIDs) are parsed/serialized via `fieldValue.ts`.
 *
 * Confirmed against Sitecore's own docs examples for `item`, `createItem`,
 * `copyItem`, and `updateItem`. `template { templateId }` on the Item type
 * follows the same standard shape as `parent { itemId path }` (confirmed via
 * the `copyItem` response example) but wasn't shown verbatim in a fetched
 * doc snippet for a plain `item` query — verify it against your instance's
 * GraphQL IDE schema browser if it doesn't resolve.
 */

export interface GraphqlOperation {
  query: string;
  variables: Record<string, unknown>;
}

export interface ItemSummary {
  itemId: string;
  name: string;
  path: string;
  templateId: string;
  parent: { itemId: string; path: string };
}

const ITEM_SUMMARY_FIELDS = `
  itemId
  name
  path
  template {
    templateId
  }
  parent {
    itemId
    path
  }
`;

export function buildGetFieldValueQuery(itemId: string, database: string): GraphqlOperation {
  return {
    query: `
      query GetItemFieldValue($itemId: ID!, $database: String!) {
        item(where: { itemId: $itemId, database: $database }) {
          itemId
          name
          path
          version
          fields(ownFields: true, excludeStandardFields: true) {
            nodes {
              name
              value
            }
          }
        }
      }
    `,
    variables: { itemId, database },
  };
}

/**
 * Fetches summary info (id/name/path/template/parent) for a batch of item
 * ids in a single round trip, using GraphQL aliasing since the Authoring API
 * exposes `item` as a single-id lookup rather than a batch query.
 */
export function buildGetItemsByIdQuery(itemIds: string[], database: string): GraphqlOperation {
  const variableDeclarations = itemIds.map((_, i) => `$itemId${i}: ID!`).join(', ');
  const aliasedFields = itemIds
    .map((_, i) => `item${i}: item(where: { itemId: $itemId${i}, database: $database }) {${ITEM_SUMMARY_FIELDS}}`)
    .join('\n');

  const variables: Record<string, unknown> = { database };
  itemIds.forEach((id, i) => {
    variables[`itemId${i}`] = id;
  });

  return {
    query: `
      query GetItemsById($database: String!, ${variableDeclarations}) {
        ${aliasedFields}
      }
    `,
    variables,
  };
}

export function extractItemsFromBatchResult(
  result: Record<string, unknown>,
  count: number,
): ItemSummary[] {
  const items: ItemSummary[] = [];
  for (let i = 0; i < count; i++) {
    const item = result[`item${i}`] as ItemSummary | null;
    if (item) items.push(item);
  }
  return items;
}

/**
 * Sitecore sanitizes/lowercases the `name` argument for the item's system
 * Name (URL-safe) and would otherwise auto-derive a differently-cased
 * Display Name from the original input — confirmed against a real tenant
 * ("fitness" / "Fitness"). Explicitly setting `__Display Name` to the exact
 * same string as `name` keeps the two in sync rather than letting them
 * diverge.
 */
export function buildCreateItemMutation(params: {
  name: string;
  templateId: string;
  parentId: string;
  language: string;
}): GraphqlOperation {
  return {
    query: `
      mutation CreateItem($name: String!, $templateId: ID!, $parentId: ID!, $language: String!) {
        createItem(
          input: {
            name: $name
            templateId: $templateId
            parent: $parentId
            language: $language
            fields: [{ name: "__Display Name", value: $name }]
          }
        ) {
          item {
            itemId
            name
            path
          }
        }
      }
    `,
    variables: params,
  };
}

export function buildCopyItemMutation(params: {
  sourceItemId: string;
  targetParentId: string;
  copyItemName: string;
}): GraphqlOperation {
  return {
    query: `
      mutation CopyItem($sourceItemId: ID!, $targetParentId: ID!, $copyItemName: String!) {
        copyItem(
          input: {
            itemId: $sourceItemId
            targetParentId: $targetParentId
            copyItemName: $copyItemName
          }
        ) {
          item {
            itemId
            name
            path
            version
          }
        }
      }
    `,
    variables: params,
  };
}

/**
 * Updates one or more fields on a single item in one call — e.g. appending
 * to the target Multilist/TreelistEx field's raw value, or (for the "copy an
 * existing item" flow, which doesn't take a `fields` input like createItem
 * does) setting the new copy's `__Display Name` to match its Name.
 */
export function buildUpdateFieldsMutation(params: {
  itemId: string;
  database: string;
  language: string;
  version: number;
  fields: Array<{ name: string; value: string }>;
}): GraphqlOperation {
  const fieldVariableDeclarations = params.fields
    .map((_, i) => `$fieldName${i}: String!, $fieldValue${i}: String!`)
    .join(', ');
  const fieldInputs = params.fields
    .map((_, i) => `{ name: $fieldName${i}, value: $fieldValue${i}, reset: false }`)
    .join(', ');

  const variables: Record<string, unknown> = {
    itemId: params.itemId,
    database: params.database,
    language: params.language,
    // `version` is the one Int variable across every mutation this app sends
    // — everything else is String/ID. Coerced explicitly here because the
    // Marketplace SDK's runtime payload for it doesn't necessarily match its
    // declared TypeScript type (`number`); a HotChocolate "Unable to convert
    // type from `String` to `Nullable`1`" error surfaced from a real tenant
    // suggests it can arrive as a string, which GraphQL's Int scalar rejects
    // outright rather than coercing.
    version: Number(params.version),
  };
  params.fields.forEach((field, i) => {
    variables[`fieldName${i}`] = field.name;
    variables[`fieldValue${i}`] = field.value;
  });

  return {
    query: `
      mutation UpdateFields(
        $itemId: ID!
        $database: String!
        $language: String!
        $version: Int!
        ${fieldVariableDeclarations}
      ) {
        updateItem(
          input: {
            itemId: $itemId
            database: $database
            language: $language
            version: $version
            fields: [${fieldInputs}]
          }
        ) {
          item {
            itemId
            fields(ownFields: true) {
              nodes {
                name
                value
              }
            }
          }
        }
      }
    `,
    variables,
  };
}
