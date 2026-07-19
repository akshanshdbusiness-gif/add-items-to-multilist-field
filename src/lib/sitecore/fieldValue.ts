/**
 * Sitecore Multilist/TreelistEx fields store their value as a pipe-delimited
 * list of item GUIDs, e.g. "{GUID1}|{GUID2}|{GUID3}".
 */

export function parseMultilistValue(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split('|')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

export function serializeMultilistValue(ids: string[]): string {
  return ids.join('|');
}

/**
 * Sitecore items can be referenced either in the classic
 * `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}` format (braces, hyphens, upper
 * case) or a compact `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` one (no braces, no
 * hyphens, lower case) — the Authoring GraphQL API returns ids in the
 * compact format, but existing Multilist/TreelistEx raw values (and
 * Sitecore's own field widgets) use the classic one. Mixing both in the same
 * pipe-delimited list produced a value like
 * `{A}|{B}|807d45852f694205928ff59257b35b8d`, confirmed against a real
 * tenant to not be what Sitecore's native field expects.
 */
export function normalizeItemId(id: string): string {
  const hex = id.replace(/[{}-]/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    // Not a recognizable GUID shape — return unchanged rather than mangle it.
    return id;
  }
  const upper = hex.toUpperCase();
  return `{${upper.slice(0, 8)}-${upper.slice(8, 12)}-${upper.slice(12, 16)}-${upper.slice(16, 20)}-${upper.slice(20)}}`;
}

export function addItemToMultilistValue(
  raw: string | null | undefined,
  newItemId: string,
): string {
  const normalizedId = normalizeItemId(newItemId);
  const ids = parseMultilistValue(raw);
  if (!ids.some((id) => id.toLowerCase() === normalizedId.toLowerCase())) {
    ids.push(normalizedId);
  }
  return serializeMultilistValue(ids);
}
