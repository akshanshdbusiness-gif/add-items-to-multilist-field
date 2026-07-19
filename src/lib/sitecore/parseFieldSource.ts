/**
 * Parses a Multilist/TreelistEx field's `Source` setting for fallback hints,
 * used when the field has no selection yet so there's nothing to infer a
 * parent/template from directly.
 *
 * Sitecore Source values for these field types are commonly one or more
 * `|`-separated Sitecore query clauses, e.g.:
 *
 *   query:$site/*[@@name='Data']/*[@@templatename='Product Listings Folder']
 *   |query:$sharedSites/*[@@name='Data']/*[@@templatename='Product Listings Folder']
 *
 * `$site` scopes a clause to the current site's own content (local);
 * `$sharedSites` scopes it to a cross-site shared content library (global).
 * This only parses the string into structured hints — resolving `$site` /
 * `$sharedSites` into a concrete item id requires an API call and is the
 * caller's responsibility.
 */

export type FieldSourceScope = 'site' | 'sharedSites' | 'other';

export interface FieldSourceLocation {
  scope: FieldSourceScope;
  raw: string;
}

export interface ParsedFieldSource {
  locations: FieldSourceLocation[];
  /** Template names found in `@@templatename='X'` filters, in the order encountered. */
  templateNameHints: string[];
}

const TEMPLATE_NAME_PATTERN = /@@templatename\s*=\s*'([^']+)'/gi;

export function parseFieldSource(source: string | null | undefined): ParsedFieldSource {
  if (!source || !source.trim()) {
    return { locations: [], templateNameHints: [] };
  }

  const clauses = source
    .split('|')
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);

  const locations: FieldSourceLocation[] = clauses.map((clause) => {
    const query = clause.startsWith('query:') ? clause.slice('query:'.length) : clause;
    let scope: FieldSourceScope = 'other';
    if (/\$site\b/i.test(query)) {
      scope = 'site';
    } else if (/\$sharedSites\b/i.test(query)) {
      scope = 'sharedSites';
    }
    return { scope, raw: query };
  });

  const templateNameHints: string[] = [];
  for (const match of source.matchAll(TEMPLATE_NAME_PATTERN)) {
    templateNameHints.push(match[1]);
  }

  return { locations, templateNameHints };
}

/**
 * Returns the field source's location clauses ordered "local first": `site`
 * scope before `sharedSites` before anything else, matching the rule that a
 * local (site-scoped) fallback is preferred over a global/shared one.
 */
export function preferredFieldSourceLocations(
  parsed: ParsedFieldSource,
): FieldSourceLocation[] {
  const scopeRank: Record<FieldSourceScope, number> = {
    site: 0,
    sharedSites: 1,
    other: 2,
  };
  return [...parsed.locations].sort((a, b) => scopeRank[a.scope] - scopeRank[b.scope]);
}
