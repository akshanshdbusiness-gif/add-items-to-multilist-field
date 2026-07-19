'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  authoringGraphql,
  getCurrentPageContext,
  getSitecoreContextId,
  reloadPagesCanvas,
  useMarketplaceClient,
  type CurrentItemUpdate,
  type CurrentPageContext,
} from '@/src/lib/marketplace/client';
import {
  buildCopyItemMutation,
  buildCreateItemMutation,
  buildGetFieldValueQuery,
  buildGetItemsByIdQuery,
  buildUpdateFieldsMutation,
  extractItemsFromBatchResult,
  type ItemSummary,
} from '@/src/lib/sitecore/queries';
import { addItemToMultilistValue, parseMultilistValue } from '@/src/lib/sitecore/fieldValue';
import { parsePresentationDetails, uniqueDataSourceIds } from '@/src/lib/sitecore/presentationDetails';
import {
  isLocalToContextPage,
  resolveNewItemLocation,
  resolveParentId,
  type SelectedItemInfo,
} from '@/src/lib/sitecore/resolveNewItem';
import { AddItemModal, type AddItemSubmission } from '@/src/components/AddItemModal';
import { SelectedItemCard } from '@/src/components/SelectedItemCard';

/**
 * XM Cloud's Authoring & Management API still addresses items by a
 * `database` argument (Sitecore's docs examples all use "master", the
 * authoring/draft database) even though XM Cloud doesn't surface databases
 * to editors the way classic Sitecore XP did.
 */
const DATABASE = 'master';

/**
 * A "Marketplace Types > Plugin" field's Source is documented as just the
 * app id — there's no confirmed convention for passing extra config (like
 * which sibling Multilist/TreelistEx field this instance manages) through
 * it. So this app is self-configuring: it stores `{ targetField }` as its
 * OWN field value via client.setValue() the first time an author opens it
 * on a given item, and reads it back via client.getValue() after that.
 * NEXT_PUBLIC_DEFAULT_TARGET_FIELD_NAME skips that one-time step for
 * deployments dedicated to a single field name.
 */
const DEFAULT_TARGET_FIELD_NAME = process.env.NEXT_PUBLIC_DEFAULT_TARGET_FIELD_NAME ?? '';

/**
 * Safety cap on how many candidate items (page + component datasources) get
 * probed for the target field — defensive against a pathological page with
 * an enormous rendering tree, not expected to matter in practice.
 */
const MAX_CANDIDATE_ITEMS = 20;

type Status = 'loading' | 'needs-config' | 'ready' | 'error';

interface PluginConfig {
  targetField: string;
}

function parsePluginConfig(raw: unknown): PluginConfig | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.targetField === 'string' && parsed.targetField) {
      return { targetField: parsed.targetField };
    }
  } catch {
    // Not JSON, or not our config shape — treat as unconfigured.
  }
  return null;
}

function toSelectedItemInfo(item: ItemSummary): SelectedItemInfo {
  return {
    id: item.itemId,
    path: item.path,
    templateId: item.templateId,
    parent: { id: item.parent.itemId, path: item.parent.path },
  };
}

interface FieldProbeResult {
  itemId: string;
  version: number;
  fieldNames: string[];
  rawValue: string;
}

/**
 * Which item a Custom Field is actually attached to (the page, or a
 * component's datasource item elsewhere on the page) isn't exposed directly
 * by the SDK. `pages.content.fieldsUpdated` can carry it, but confirmed
 * against a real tenant to be change-driven, not a reliable "give me the
 * current item" signal — it doesn't fire just because this app opened, so
 * relying on it meant the app worked once and then intermittently failed on
 * every later open with no way to force it to fire again.
 *
 * Instead: `pages.context.pageInfo.presentationDetails` reliably lists every
 * rendering on the page and its datasource item id. Whichever one of those
 * items (or the page itself) actually *has* a field named `field` is almost
 * certainly the right one — so probe them all and use whichever one matches,
 * rather than guessing from an event.
 */
async function resolveTargetItem(
  client: NonNullable<ReturnType<typeof useMarketplaceClient>['client']>,
  sitecoreContextId: string,
  pageContext: CurrentPageContext,
  field: string,
): Promise<
  | { status: 'found'; item: CurrentItemUpdate; probe: FieldProbeResult; ambiguousCount: number }
  | { status: 'not-found'; candidateCount: number }
> {
  const renderings = parsePresentationDetails(pageContext.presentationDetails);
  const candidateIds = [pageContext.itemId, ...uniqueDataSourceIds(renderings)].slice(
    0,
    MAX_CANDIDATE_ITEMS,
  );

  const probes = await Promise.all(
    candidateIds.map(async (itemId): Promise<FieldProbeResult | null> => {
      try {
        const { query, variables } = buildGetFieldValueQuery(itemId, DATABASE);
        const result = await authoringGraphql<{
          item: { version: number; fields: { nodes: { name: string; value: string }[] } };
        }>(client, sitecoreContextId, query, variables);
        const nodes = result.item.fields.nodes;
        return {
          itemId,
          version: result.item.version ?? 1,
          fieldNames: nodes.map((n) => n.name),
          rawValue: nodes.find((n) => n.name === field)?.value ?? '',
        };
      } catch {
        // An unreadable/broken candidate shouldn't block resolving the rest.
        return null;
      }
    }),
  );

  const matches = probes.filter(
    (p): p is FieldProbeResult => p !== null && p.fieldNames.includes(field),
  );

  if (matches.length === 0) {
    return { status: 'not-found', candidateCount: candidateIds.length };
  }

  // Prefer a component datasource over the page itself when ambiguous —
  // that's the more likely intended target for a field-level companion app.
  const winner =
    matches.find((m) => m.itemId !== pageContext.itemId) ?? matches[0];

  return {
    status: 'found',
    item: { itemId: winner.itemId, language: pageContext.language, itemVersion: winner.version },
    probe: winner,
    ambiguousCount: matches.length,
  };
}

export default function AddItemPage() {
  const { client, error: clientError } = useMarketplaceClient();

  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [fieldNameInput, setFieldNameInput] = useState('');

  const [targetField, setTargetField] = useState<string>(DEFAULT_TARGET_FIELD_NAME);
  const [contextId, setContextId] = useState<string | null>(null);
  const [pageContext, setPageContext] = useState<CurrentPageContext | null>(null);
  const [currentItem, setCurrentItem] = useState<CurrentItemUpdate | null>(null);
  const [ambiguousCount, setAmbiguousCount] = useState(0);
  const [rawFieldValue, setRawFieldValue] = useState<string>('');
  const [selectedItems, setSelectedItems] = useState<ItemSummary[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

  const pagePath = pageContext?.path ?? '';

  // Reliable, always available — the page itself, plus its rendering tree
  // (presentationDetails) used to find the actual target item below. Also
  // the source of the page's own path for the local-vs-global rule.
  useEffect(() => {
    if (!client) return;
    getCurrentPageContext(client)
      .then(setPageContext)
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Could not resolve the current page.');
        setStatus('error');
      });
  }, [client]);

  // Resolves which sibling field this instance manages, independent of
  // which item that field lives on (see loadEverything below for that part).
  useEffect(() => {
    if (!client) return;
    let cancelled = false;

    (async () => {
      try {
        const value = await client.getValue();
        const config = parsePluginConfig(value);
        if (cancelled) return;

        const field = config?.targetField || DEFAULT_TARGET_FIELD_NAME;
        if (field) {
          setTargetField(field);
        } else {
          setStatus('needs-config');
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not read this field's configuration.");
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client]);

  const loadEverything = useCallback(
    async (field: string) => {
      if (!client || !pageContext) return;
      setStatus('loading');
      setError(null);
      try {
        const sitecoreContextId = await getSitecoreContextId(client);
        setContextId(sitecoreContextId);

        const resolved = await resolveTargetItem(client, sitecoreContextId, pageContext, field);
        if (resolved.status === 'not-found') {
          throw new Error(
            `No field named "${field}" was found on the page item or any of its ` +
              `${resolved.candidateCount - 1} component datasource items. Confirm the field ` +
              'name is spelled exactly as it appears on the template.',
          );
        }

        // If the companion Plugin field was named the same as the target
        // field, the probe above can match our OWN field instead of the real
        // Multilist/TreelistEx one — its value is our own `{targetField}`
        // config JSON, not a GUID list, and would otherwise get silently fed
        // into an ID variable further down (confirmed against a real tenant:
        // Sitecore rejects it with an opaque "Unable to convert type from
        // `String` to `Nullable`1`" GraphQL error instead of a useful one).
        if (parsePluginConfig(resolved.probe.rawValue)) {
          throw new Error(
            `The field named "${field}" found on this item is this app's own companion field, ` +
              `not the real Multilist/TreelistEx field — they can't share a name. Rename the ` +
              `companion field (Type: Marketplace Types > Plugin) on the template to something ` +
              `else, e.g. "Add Item".`,
          );
        }

        setCurrentItem(resolved.item);
        setAmbiguousCount(resolved.ambiguousCount);
        setRawFieldValue(resolved.probe.rawValue);

        const ids = parseMultilistValue(resolved.probe.rawValue);
        let items: ItemSummary[] = [];
        if (ids.length > 0) {
          const batch = buildGetItemsByIdQuery(ids, DATABASE);
          const batchResult = await authoringGraphql<Record<string, unknown>>(
            client,
            sitecoreContextId,
            batch.query,
            batch.variables,
          );
          items = extractItemsFromBatchResult(batchResult, ids.length);
        }
        setSelectedItems(items);
        setStatus('ready');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong loading the field.');
        setStatus('error');
      }
    },
    [client, pageContext],
  );

  // Runs once both the target field name and the page context are known.
  useEffect(() => {
    if (!targetField || !pageContext) return;
    loadEverything(targetField);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetField, pageContext]);

  const handleSaveConfig = async () => {
    if (!client) return;
    const field = fieldNameInput.trim();
    if (!field) return;
    await client.setValue(JSON.stringify({ targetField: field }), false);
    setTargetField(field);
  };

  const handleSubmitNewItem = async (input: AddItemSubmission) => {
    if (!client || !contextId || !currentItem) {
      throw new Error('Still loading — try again in a moment.');
    }

    const selectedInfos = selectedItems.map(toSelectedItemInfo);
    let newItemId: string;

    if (input.copyFromItemId) {
      const parentResult = resolveParentId(selectedInfos, pagePath);
      if (!parentResult.ok) throw new Error(parentResult.error);

      const copyOp = buildCopyItemMutation({
        sourceItemId: input.copyFromItemId,
        targetParentId: parentResult.parentId,
        copyItemName: input.name,
      });
      const result = await authoringGraphql<{
        copyItem: { item: { itemId: string; version: number } };
      }>(client, contextId, copyOp.query, copyOp.variables);
      newItemId = result.copyItem.item.itemId;

      // copyItem (unlike createItem) has no `fields` input, so the copy
      // starts out with the *source* item's Display Name — set it to match
      // the entered name in a follow-up call, same as createItem does inline.
      const displayNameOp = buildUpdateFieldsMutation({
        itemId: newItemId,
        database: DATABASE,
        language: currentItem.language,
        version: result.copyItem.item.version,
        fields: [{ name: '__Display Name', value: input.name }],
      });
      await authoringGraphql(client, contextId, displayNameOp.query, displayNameOp.variables);
    } else {
      // NOTE: when the field has no current selection (or a mixed-template
      // selection), resolveNewItemLocation falls back to the `fallback`
      // param below, which is intentionally left empty — resolving the
      // field's Source `$site`/`$sharedSites`/`@@templatename` hints into a
      // concrete parent/template id needs extra Authoring API lookups
      // specific to each site's content tree (see parseFieldSource.ts and
      // the README). Wire that resolution in here if your fields are
      // commonly empty when "Add Item" is used.
      const locationResult = resolveNewItemLocation(selectedInfos, pagePath, {});
      if (!locationResult.ok) throw new Error(locationResult.error);

      const createOp = buildCreateItemMutation({
        name: input.name,
        templateId: locationResult.templateId,
        parentId: locationResult.parentId,
        language: currentItem.language,
      });
      const result = await authoringGraphql<{ createItem: { item: { itemId: string } } }>(
        client,
        contextId,
        createOp.query,
        createOp.variables,
      );
      newItemId = result.createItem.item.itemId;
    }

    // addItemToMultilistValue appends, so the new item ends up last in the
    // field's raw value — Sitecore's native field widget follows that order.
    const newRawValue = addItemToMultilistValue(rawFieldValue, newItemId);
    const updateOp = buildUpdateFieldsMutation({
      itemId: currentItem.itemId,
      database: DATABASE,
      language: currentItem.language,
      version: currentItem.itemVersion,
      fields: [{ name: targetField, value: newRawValue }],
    });
    await authoringGraphql(client, contextId, updateOp.query, updateOp.variables);

    // This app writes directly via the Authoring API, bypassing Sitecore's
    // own field-editing flow — the canvas (including the native Categories
    // field widget) has no reason to know anything changed without this.
    await reloadPagesCanvas(client);

    setModalOpen(false);
    await loadEverything(targetField);
  };

  if (clientError) {
    return <ErrorState message={`Could not connect to Sitecore: ${clientError.message}`} />;
  }

  if (status === 'error' && error) {
    return <ErrorState message={error} />;
  }

  if (status === 'needs-config') {
    return (
      <div style={{ padding: '1rem' }}>
        <p>
          This is the first time &quot;Add Item&quot; is being used on this item. Enter the name
          of the Multilist/TreelistEx field it should manage (exactly as it appears on the
          template):
        </p>
        <label className="modal-field">
          Field name
          <input
            type="text"
            value={fieldNameInput}
            onChange={(event) => setFieldNameInput(event.target.value)}
          />
        </label>
        <button type="button" onClick={handleSaveConfig} disabled={!fieldNameInput.trim()}>
          Save
        </button>
      </div>
    );
  }

  if (status === 'loading' || !currentItem) {
    return <div style={{ padding: '1rem' }}>Loading…</div>;
  }

  return (
    <div style={{ padding: '1rem' }}>
      {ambiguousCount > 1 && (
        <p style={{ color: '#8a6d00', fontSize: '0.85rem' }}>
          {ambiguousCount} items on this page have a field named &quot;{targetField}&quot;, so
          which one this refers to is ambiguous — currently using a component&apos;s datasource
          item over the page itself, but double-check this is the right one.
        </p>
      )}
      {selectedItems.map((item) => (
        <SelectedItemCard
          key={item.itemId}
          item={item}
          isLocal={isLocalToContextPage(item.path, pagePath)}
        />
      ))}

      <button type="button" className="add-item-button" onClick={() => setModalOpen(true)}>
        + Add item
      </button>

      {modalOpen && (
        <AddItemModal
          selectedItems={selectedItems}
          onClose={() => setModalOpen(false)}
          onSubmit={handleSubmitNewItem}
        />
      )}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div style={{ padding: '1rem', color: '#b00020' }}>
      <p>{message}</p>
    </div>
  );
}
