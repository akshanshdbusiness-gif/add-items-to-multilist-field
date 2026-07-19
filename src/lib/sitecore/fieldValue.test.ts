import { describe, expect, it } from 'vitest';
import {
  addItemToMultilistValue,
  normalizeItemId,
  parseMultilistValue,
  serializeMultilistValue,
} from './fieldValue';

describe('parseMultilistValue', () => {
  it('splits a pipe-delimited list of GUIDs', () => {
    expect(parseMultilistValue('{A}|{B}|{C}')).toEqual(['{A}', '{B}', '{C}']);
  });

  it('returns an empty array for null/undefined/empty input', () => {
    expect(parseMultilistValue(null)).toEqual([]);
    expect(parseMultilistValue(undefined)).toEqual([]);
    expect(parseMultilistValue('')).toEqual([]);
  });

  it('ignores stray whitespace and empty segments from leading/trailing/double pipes', () => {
    expect(parseMultilistValue(' {A} | {B} ||{C}|')).toEqual(['{A}', '{B}', '{C}']);
  });

  it('handles a single item with no pipes', () => {
    expect(parseMultilistValue('{A}')).toEqual(['{A}']);
  });
});

describe('serializeMultilistValue', () => {
  it('joins ids with a pipe', () => {
    expect(serializeMultilistValue(['{A}', '{B}'])).toBe('{A}|{B}');
  });

  it('returns an empty string for an empty list', () => {
    expect(serializeMultilistValue([])).toBe('');
  });
});

describe('normalizeItemId', () => {
  it('converts a compact lower-case id (no braces/hyphens) to classic format', () => {
    expect(normalizeItemId('807d45852f694205928ff59257b35b8d')).toBe(
      '{807D4585-2F69-4205-928F-F59257B35B8D}',
    );
  });

  it('leaves an already-classic-format id unchanged (aside from case)', () => {
    expect(normalizeItemId('{3B8B5DB1-201C-4762-BF46-D778C0303C81}')).toBe(
      '{3B8B5DB1-201C-4762-BF46-D778C0303C81}',
    );
  });

  it('uppercases a lower-case classic-format id', () => {
    expect(normalizeItemId('{3b8b5db1-201c-4762-bf46-d778c0303c81}')).toBe(
      '{3B8B5DB1-201C-4762-BF46-D778C0303C81}',
    );
  });

  it('returns non-GUID-shaped input unchanged rather than mangling it', () => {
    expect(normalizeItemId('not-a-guid')).toBe('not-a-guid');
  });
});

describe('addItemToMultilistValue', () => {
  it('appends a new id to an existing list', () => {
    expect(addItemToMultilistValue('{A}|{B}', '{C}')).toBe('{A}|{B}|{C}');
  });

  it('starts a new list when the raw value is empty', () => {
    expect(addItemToMultilistValue(null, '{A}')).toBe('{A}');
    expect(addItemToMultilistValue('', '{A}')).toBe('{A}');
  });

  it('does not duplicate an id that is already present (case-insensitive)', () => {
    expect(addItemToMultilistValue('{A}|{B}', '{b}')).toBe('{A}|{B}');
  });

  it('normalizes a compact-format new id to classic format before appending', () => {
    // Regression: the Authoring API returns new item ids in compact form
    // (no braces/hyphens), which produced a mixed-format raw value like
    // "{A}|{B}|807d45852f694205928ff59257b35b8d" when appended as-is.
    expect(
      addItemToMultilistValue(
        '{3B8B5DB1-201C-4762-BF46-D778C0303C81}',
        '807d45852f694205928ff59257b35b8d',
      ),
    ).toBe('{3B8B5DB1-201C-4762-BF46-D778C0303C81}|{807D4585-2F69-4205-928F-F59257B35B8D}');
  });

  it('does not duplicate when the new id is the compact form of an existing classic-format id', () => {
    expect(
      addItemToMultilistValue(
        '{807D4585-2F69-4205-928F-F59257B35B8D}',
        '807d45852f694205928ff59257b35b8d',
      ),
    ).toBe('{807D4585-2F69-4205-928F-F59257B35B8D}');
  });
});
