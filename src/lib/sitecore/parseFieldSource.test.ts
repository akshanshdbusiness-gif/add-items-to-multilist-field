import { describe, expect, it } from 'vitest';
import { parseFieldSource, preferredFieldSourceLocations } from './parseFieldSource';

describe('parseFieldSource', () => {
  it('returns empty results for a blank/missing source', () => {
    expect(parseFieldSource(null)).toEqual({ locations: [], templateNameHints: [] });
    expect(parseFieldSource(undefined)).toEqual({ locations: [], templateNameHints: [] });
    expect(parseFieldSource('   ')).toEqual({ locations: [], templateNameHints: [] });
  });

  it('parses a single $site query clause and its template hint', () => {
    const parsed = parseFieldSource(
      "query:$site/*[@@name='Data']/*[@@templatename='Product Listings Folder']",
    );
    expect(parsed.locations).toEqual([
      { scope: 'site', raw: "$site/*[@@name='Data']/*[@@templatename='Product Listings Folder']" },
    ]);
    expect(parsed.templateNameHints).toEqual(['Product Listings Folder']);
  });

  it('parses combined $site | $sharedSites clauses', () => {
    const parsed = parseFieldSource(
      "query:$site/*[@@name='Data']/*[@@templatename='Cards Folder']" +
        "|query:$sharedSites/*[@@name='Data']/*[@@templatename='Cards Folder']",
    );
    expect(parsed.locations).toEqual([
      { scope: 'site', raw: "$site/*[@@name='Data']/*[@@templatename='Cards Folder']" },
      { scope: 'sharedSites', raw: "$sharedSites/*[@@name='Data']/*[@@templatename='Cards Folder']" },
    ]);
    expect(parsed.templateNameHints).toEqual(['Cards Folder', 'Cards Folder']);
  });

  it('classifies a clause with neither token as "other"', () => {
    const parsed = parseFieldSource('/sitecore/content/Foo/Data');
    expect(parsed.locations).toEqual([{ scope: 'other', raw: '/sitecore/content/Foo/Data' }]);
  });
});

describe('preferredFieldSourceLocations', () => {
  it('orders site before sharedSites before other', () => {
    const parsed = parseFieldSource(
      "query:$sharedSites/*[@@templatename='A']" +
        "|query:/sitecore/content/Other" +
        "|query:$site/*[@@templatename='A']",
    );
    const ordered = preferredFieldSourceLocations(parsed);
    expect(ordered.map((l) => l.scope)).toEqual(['site', 'sharedSites', 'other']);
  });

  it('returns an empty array when there are no locations', () => {
    expect(preferredFieldSourceLocations({ locations: [], templateNameHints: [] })).toEqual([]);
  });
});
