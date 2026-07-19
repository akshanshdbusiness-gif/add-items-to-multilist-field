import { describe, expect, it } from 'vitest';
import { parsePresentationDetails, uniqueDataSourceIds } from './presentationDetails';

// Shape confirmed against a real tenant's pages.context.pageInfo.presentationDetails.
const REAL_SHAPE = JSON.stringify({
  devices: [
    {
      id: 'fe5d7fdf-89c0-4d99-9aa3-b5fbd009c9f3',
      layoutId: '96e5f4ba-a2cf-4a4c-a4e7-64da88226362',
      placeholders: [],
      renderings: [
        {
          id: '9b5e1e18-fd8d-5e80-8028-861d007dca15',
          instanceId: 'b1247ad6-a0c6-4967-a02a-a325c0ca6a7f',
          placeholderKey: '/headless-main/sxa-main/container-1',
          dataSource: 'b480e5fa-e4d0-4c4a-b42d-033e697680ed',
          parameters: { FieldNames: '', Styles: '', RenderingIdentifier: '', CSSStyles: '' },
        },
      ],
    },
  ],
});

describe('parsePresentationDetails', () => {
  it('returns an empty array for missing/blank input', () => {
    expect(parsePresentationDetails(null)).toEqual([]);
    expect(parsePresentationDetails(undefined)).toEqual([]);
    expect(parsePresentationDetails('')).toEqual([]);
  });

  it('returns an empty array for malformed JSON rather than throwing', () => {
    expect(parsePresentationDetails('{not json')).toEqual([]);
  });

  it('parses renderings across devices, including their dataSource', () => {
    const renderings = parsePresentationDetails(REAL_SHAPE);
    expect(renderings).toEqual([
      {
        id: '9b5e1e18-fd8d-5e80-8028-861d007dca15',
        instanceId: 'b1247ad6-a0c6-4967-a02a-a325c0ca6a7f',
        placeholderKey: '/headless-main/sxa-main/container-1',
        dataSource: 'b480e5fa-e4d0-4c4a-b42d-033e697680ed',
      },
    ]);
  });

  it('skips renderings with no dataSource rather than failing', () => {
    const raw = JSON.stringify({
      devices: [{ renderings: [{ id: 'r1', placeholderKey: '/x' }] }],
    });
    const renderings = parsePresentationDetails(raw);
    expect(renderings).toEqual([{ id: 'r1', instanceId: undefined, placeholderKey: '/x', dataSource: undefined }]);
  });
});

describe('uniqueDataSourceIds', () => {
  it('extracts unique, non-empty datasource ids', () => {
    const renderings = parsePresentationDetails(REAL_SHAPE);
    expect(uniqueDataSourceIds(renderings)).toEqual(['b480e5fa-e4d0-4c4a-b42d-033e697680ed']);
  });

  it('dedupes repeated datasource ids and drops empty ones', () => {
    const raw = JSON.stringify({
      devices: [
        {
          renderings: [
            { id: 'r1', dataSource: 'X' },
            { id: 'r2', dataSource: 'X' },
            { id: 'r3', dataSource: '' },
            { id: 'r4' },
          ],
        },
      ],
    });
    expect(uniqueDataSourceIds(parsePresentationDetails(raw))).toEqual(['X']);
  });
});
