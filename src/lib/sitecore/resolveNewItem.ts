/**
 * Business rules for where a new item (created via "Add Item") should live:
 *
 * - Parent: the parent of whichever currently-selected item is "local" (its
 *   path falls under the current context page) rather than global/shared.
 *   If several are local, the first one found is used. If none are local,
 *   the parent of the first selected item is used. If nothing is selected,
 *   a caller-supplied fallback (resolved from the field's Source setting)
 *   is used instead.
 * - Template: the common template of the currently-selected items, if they
 *   all share one. If they don't (or nothing is selected), a caller-supplied
 *   fallback template is used. This only applies to the "create a blank new
 *   item" flow — "copy an existing item" always uses the copied item's own
 *   template and doesn't need this.
 *
 * Resolving `$site`/`$sharedSites` source tokens into concrete ids requires
 * an API call, so it happens before these functions are called; these stay
 * pure and synchronous so the rules themselves are easy to unit test.
 */

export interface SelectedItemInfo {
  id: string;
  path: string;
  templateId: string;
  parent: { id: string; path: string };
}

export type ResolveResult<T extends Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

function normalizePath(path: string): string {
  return path.trim().replace(/\/+$/, '').toLowerCase();
}

export function isLocalToContextPage(itemPath: string, contextPagePath: string): boolean {
  const item = normalizePath(itemPath);
  const context = normalizePath(contextPagePath);
  if (!item || !context) return false;
  return item === context || item.startsWith(`${context}/`);
}

export function resolveParentId(
  selectedItems: SelectedItemInfo[],
  contextPagePath: string,
  fallbackParentId?: string,
): ResolveResult<{ parentId: string }> {
  const localItem = selectedItems.find((item) =>
    isLocalToContextPage(item.path, contextPagePath),
  );
  if (localItem) {
    return { ok: true, parentId: localItem.parent.id };
  }
  if (selectedItems.length > 0) {
    return { ok: true, parentId: selectedItems[0].parent.id };
  }
  if (fallbackParentId) {
    return { ok: true, parentId: fallbackParentId };
  }
  return {
    ok: false,
    error:
      "Cannot determine a parent location for the new item: the field has no current " +
      "selection and no usable location was found in the field's Source setting.",
  };
}

export function resolveTemplateId(
  selectedItems: SelectedItemInfo[],
  fallbackTemplateId?: string,
): ResolveResult<{ templateId: string }> {
  const templateIds = new Set(selectedItems.map((item) => item.templateId));
  if (templateIds.size === 1) {
    return { ok: true, templateId: [...templateIds][0] };
  }
  if (fallbackTemplateId) {
    return { ok: true, templateId: fallbackTemplateId };
  }
  if (templateIds.size > 1) {
    return {
      ok: false,
      error:
        "Selected items use different templates, so the template for the new item is " +
        "ambiguous, and no fallback template was found in the field's Source setting.",
    };
  }
  return {
    ok: false,
    error:
      "Cannot determine a template for the new item: the field has no current selection " +
      "and no template hint was found in the field's Source setting.",
  };
}

export interface ResolveNewItemFallback {
  parentId?: string;
  templateId?: string;
}

/** Convenience wrapper for the "create a blank new item" flow, which needs both. */
export function resolveNewItemLocation(
  selectedItems: SelectedItemInfo[],
  contextPagePath: string,
  fallback: ResolveNewItemFallback = {},
): ResolveResult<{ parentId: string; templateId: string }> {
  const parent = resolveParentId(selectedItems, contextPagePath, fallback.parentId);
  if (!parent.ok) return parent;

  const template = resolveTemplateId(selectedItems, fallback.templateId);
  if (!template.ok) return template;

  return { ok: true, parentId: parent.parentId, templateId: template.templateId };
}
