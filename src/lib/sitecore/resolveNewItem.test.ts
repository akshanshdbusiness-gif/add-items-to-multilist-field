import { describe, expect, it } from 'vitest';
import {
  isLocalToContextPage,
  resolveNewItemLocation,
  resolveParentId,
  resolveTemplateId,
  type SelectedItemInfo,
} from './resolveNewItem';

const CONTEXT_PAGE = '/sitecore/content/Site/Home/Products';

const localItem: SelectedItemInfo = {
  id: '{LOCAL-1}',
  path: '/sitecore/content/Site/Home/Products/Data/card-1',
  templateId: '{TEMPLATE-CARD}',
  parent: { id: '{LOCAL-PARENT}', path: '/sitecore/content/Site/Home/Products/Data' },
};

const secondLocalItem: SelectedItemInfo = {
  id: '{LOCAL-2}',
  path: '/sitecore/content/Site/Home/Products/Data/card-2',
  templateId: '{TEMPLATE-CARD}',
  parent: { id: '{LOCAL-PARENT}', path: '/sitecore/content/Site/Home/Products/Data' },
};

const globalItem: SelectedItemInfo = {
  id: '{GLOBAL-1}',
  path: '/sitecore/content/Shared Sites/Data/card-shared',
  templateId: '{TEMPLATE-CARD}',
  parent: { id: '{GLOBAL-PARENT}', path: '/sitecore/content/Shared Sites/Data' },
};

const differentTemplateItem: SelectedItemInfo = {
  ...localItem,
  id: '{LOCAL-3}',
  templateId: '{TEMPLATE-OTHER}',
};

describe('isLocalToContextPage', () => {
  it('is true for a descendant path', () => {
    expect(isLocalToContextPage(localItem.path, CONTEXT_PAGE)).toBe(true);
  });

  it('is false for a path outside the context page', () => {
    expect(isLocalToContextPage(globalItem.path, CONTEXT_PAGE)).toBe(false);
  });

  it('is case-insensitive and tolerant of a trailing slash', () => {
    expect(isLocalToContextPage(localItem.path.toUpperCase(), `${CONTEXT_PAGE}/`)).toBe(true);
  });

  it('does not treat a sibling path with a shared prefix as local', () => {
    expect(isLocalToContextPage('/sitecore/content/Site/Home/ProductsArchive/x', CONTEXT_PAGE)).toBe(
      false,
    );
  });
});

describe('resolveParentId', () => {
  it('prefers the parent of a local item over a global one', () => {
    const result = resolveParentId([globalItem, localItem], CONTEXT_PAGE);
    expect(result).toEqual({ ok: true, parentId: '{LOCAL-PARENT}' });
  });

  it('falls back to the first selected item when none are local', () => {
    const result = resolveParentId([globalItem], CONTEXT_PAGE);
    expect(result).toEqual({ ok: true, parentId: '{GLOBAL-PARENT}' });
  });

  it('uses the supplied fallback when nothing is selected', () => {
    const result = resolveParentId([], CONTEXT_PAGE, '{FALLBACK-PARENT}');
    expect(result).toEqual({ ok: true, parentId: '{FALLBACK-PARENT}' });
  });

  it('errors when nothing is selected and there is no fallback', () => {
    const result = resolveParentId([], CONTEXT_PAGE);
    expect(result.ok).toBe(false);
  });
});

describe('resolveTemplateId', () => {
  it('uses the shared template when all selected items match', () => {
    const result = resolveTemplateId([localItem, secondLocalItem]);
    expect(result).toEqual({ ok: true, templateId: '{TEMPLATE-CARD}' });
  });

  it('falls back to the supplied template when selections use mixed templates', () => {
    const result = resolveTemplateId([localItem, differentTemplateItem], '{FALLBACK-TEMPLATE}');
    expect(result).toEqual({ ok: true, templateId: '{FALLBACK-TEMPLATE}' });
  });

  it('errors on mixed templates with no fallback', () => {
    const result = resolveTemplateId([localItem, differentTemplateItem]);
    expect(result.ok).toBe(false);
  });

  it('errors when nothing is selected and there is no fallback', () => {
    const result = resolveTemplateId([]);
    expect(result.ok).toBe(false);
  });

  it('uses the fallback when nothing is selected', () => {
    const result = resolveTemplateId([], '{FALLBACK-TEMPLATE}');
    expect(result).toEqual({ ok: true, templateId: '{FALLBACK-TEMPLATE}' });
  });
});

describe('resolveNewItemLocation', () => {
  it('resolves both parent and template for a clean local selection', () => {
    const result = resolveNewItemLocation([localItem, secondLocalItem], CONTEXT_PAGE);
    expect(result).toEqual({
      ok: true,
      parentId: '{LOCAL-PARENT}',
      templateId: '{TEMPLATE-CARD}',
    });
  });

  it('prefers local parent even when template needs a fallback', () => {
    const result = resolveNewItemLocation([globalItem, localItem, differentTemplateItem], CONTEXT_PAGE, {
      templateId: '{FALLBACK-TEMPLATE}',
    });
    expect(result).toEqual({
      ok: true,
      parentId: '{LOCAL-PARENT}',
      templateId: '{FALLBACK-TEMPLATE}',
    });
  });

  it('surfaces the template error even when the parent resolves fine', () => {
    const result = resolveNewItemLocation([localItem, differentTemplateItem], CONTEXT_PAGE);
    expect(result.ok).toBe(false);
  });

  it('surfaces the parent error before attempting template resolution', () => {
    const result = resolveNewItemLocation([], CONTEXT_PAGE);
    expect(result.ok).toBe(false);
  });
});
