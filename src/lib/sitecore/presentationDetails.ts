/**
 * Parses a page's `presentationDetails` JSON (from pages.context.pageInfo) —
 * the rendering tree for the page, each rendering optionally carrying a
 * `dataSource` item id. Used to find candidate datasource items to check for
 * the target field, as a deterministic alternative to the unreliable
 * `pages.content.fieldsUpdated` event (see client.ts).
 *
 * Observed shape (not formally documented):
 *   { "devices": [ { "renderings": [ { "id", "instanceId", "placeholderKey",
 *     "dataSource", "parameters" }, ... ] }, ... ] }
 */

export interface PresentationRendering {
  id: string;
  instanceId?: string;
  placeholderKey?: string;
  dataSource?: string;
}

export function parsePresentationDetails(raw: string | null | undefined): PresentationRendering[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const devices = isRecord(parsed) && Array.isArray(parsed.devices) ? parsed.devices : [];
  const renderings: PresentationRendering[] = [];
  for (const device of devices) {
    const deviceRenderings = isRecord(device) && Array.isArray(device.renderings) ? device.renderings : [];
    for (const rendering of deviceRenderings) {
      if (isRecord(rendering) && typeof rendering.id === 'string') {
        renderings.push({
          id: rendering.id,
          instanceId: typeof rendering.instanceId === 'string' ? rendering.instanceId : undefined,
          placeholderKey: typeof rendering.placeholderKey === 'string' ? rendering.placeholderKey : undefined,
          dataSource: typeof rendering.dataSource === 'string' ? rendering.dataSource : undefined,
        });
      }
    }
  }
  return renderings;
}

/** Unique, non-empty datasource item ids referenced by the page's renderings. */
export function uniqueDataSourceIds(renderings: PresentationRendering[]): string[] {
  const ids = renderings
    .map((r) => r.dataSource)
    .filter((id): id is string => Boolean(id && id.trim()));
  return [...new Set(ids)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
