# Add Items to Multilist Field

A Sitecore Marketplace app for content authors. Sitecore Pages already lets you
*select* existing items in a Multilist/TreelistEx field, but creating a brand-new item
(or cloning one you already picked) means leaving the canvas, working in the content
tree, then coming back to select it. This app adds an "Add item" button next to the
field so an author can create a sibling item — or copy an already-selected card as a
starting point — and have it appear pre-selected in the field, without leaving Pages.

## How it works

- The real Multilist/TreelistEx field is left completely alone: its Type never
  changes, so every existing query against it (e.g. Experience Edge/Layout Service
  `... on MultilistField { targetItems { ... } }` fragments) keeps working.
- This app is a **Page Builder Custom Field** extension, added as an *additional*
  companion field on the same template (Type: `Marketplace Types > Plugin`). Clicking
  "Open app" on that field opens this app in a modal next to the real field's card
  list.
- All reads and writes go through the **Authoring & Management GraphQL API**
  (`xmc.authoring.graphql`), live — not deferred to the Pages "Save" button. Creating
  an item and adding it to the field happens in one action.
- **Which item the field actually lives on** (the page itself, or a component's
  datasource item elsewhere on the page) isn't reliably exposed by the SDK — confirmed
  against a real tenant that `pages.context.pageInfo` always resolves to the *page*, and
  that `pages.content.fieldsUpdated` (which can carry a component's datasource id) is
  change-driven, not a "give me the current item" signal — it worked once, then didn't
  fire at all on a later open with nothing changed, so it isn't used. Instead, this app
  reads `pages.context.pageInfo.presentationDetails` (the page's rendering tree, each
  rendering optionally carrying a `dataSource` item id — see
  [`presentationDetails.ts`](src/lib/sitecore/presentationDetails.ts)), and probes the
  page item plus every component datasource on the page for one that actually *has* the
  target field. Whichever one does, wins — deterministic every time rather than
  depending on an event that may or may not fire. See `resolveTargetItem` in
  [`src/app/add-item/page.tsx`](src/app/add-item/page.tsx) and the doc comment on
  `getCurrentPageContext` in [`src/lib/marketplace/client.ts`](src/lib/marketplace/client.ts).


## Business rules

- **Parent** for a new/copied item: the parent of whichever currently-selected item is
  "local" (its path falls under the current page) rather than global/shared. If none
  are local, the parent of the first selected item is used.
- **Template** for a brand-new (non-copied) item: the common template of the
  currently-selected items, if they all share one. "Copy an existing item" always uses
  the copied item's own template instead (via the `copyItem` mutation).
- If neither can be resolved (e.g. the field is empty and there's no fallback), the
  modal shows an inline error instead of guessing.

These rules are implemented as pure, unit-tested functions in
[`src/lib/sitecore/resolveNewItem.ts`](src/lib/sitecore/resolveNewItem.ts).

## New item details

- **Display Name**: Sitecore sanitizes/lowercases the `name` you type into the item's
  system Name (URL-safe), and by default auto-derives a differently-cased Display Name
  from your original input (e.g. `fitness` / `Fitness`). This app explicitly sets
  `__Display Name` to the exact same string as `name` for both a brand-new item
  (inline, in the same `createItem` call) and a copy (a follow-up `updateItem` call,
  since `copyItem` has no `fields` input and would otherwise keep the *source* item's
  Display Name) — see `buildCreateItemMutation`/`buildUpdateFieldsMutation` in
  [`queries.ts`](src/lib/sitecore/queries.ts).
- **Position in the field**: `addItemToMultilistValue` appends, so the new item is
  always last in the field's raw value.
- **Canvas refresh**: since this app writes directly via the Authoring API rather than
  through Sitecore's own field-editing flow, the canvas has no reason to know anything
  changed — `reloadPagesCanvas` (`pages.reloadCanvas`) is called after every successful
  add so the native field widget picks up the new selection immediately.
- The "copy fields from an existing item" dropdown in the Add Item modal is sorted
  alphabetically by name, independent of the field's raw selection order.

## Known limitation: empty-field fallback

When the field has **no current selection**, there's nothing to infer a parent or
template from. The intended fallback is to parse the field's `Source` setting (see
[`src/lib/sitecore/parseFieldSource.ts`](src/lib/sitecore/parseFieldSource.ts), which
handles the `$site`/`$sharedSites`/`@@templatename` query-token convention), then
resolve those tokens into real item ids via the Sitecore Sites API. That last step
needs additional Authoring API calls specific to each site's content tree and is
**not wired in yet** — see the `NOTE` in
[`src/app/add-item/page.tsx`](src/app/add-item/page.tsx). If your fields are commonly
empty when authors reach for "Add item", implement that resolution before relying on
this app; otherwise authors will see an inline error and can add an item the normal
way first.

## Sitecore-side setup

1. Register a Marketplace app (custom app, for internal use, or public):
   - Extension point: **Page Builder Custom Field**.
   - API access: **Authoring & Management API**.
   - Deploy this app and point the app's URL at `/add-item`.
2. On each template that has a Multilist/TreelistEx field you want this on:
   - Open the template in Content Editor → Builder → **Add a new field**.
   - Name it anything **other than the target field's own name** (e.g. "Add item" — not
     "Categories" if that's the field it'll manage; a same-name collision confirmed to
     make this app read its own config value instead of the real field and fail with an
     opaque GraphQL error), **Type**: `Marketplace Types > Plugin`, **Source**: this
     app's Marketplace app id.
3. Reload Pages. The new field (and its "Open app" button) appears next to the real
   Multilist/TreelistEx field's panel.
4. **First use per item**: since a Plugin field's `Source` only carries the app id (no
   confirmed way to pass extra config through it), this app is self-configuring — the
   first time it's opened on a given item it asks which field name it should manage,
   then remembers that via its own field value. To skip this per-item prompt for a
   deployment dedicated to a single field name, set
   `NEXT_PUBLIC_DEFAULT_TARGET_FIELD_NAME` at build time.

## Getting started

```sh
npm install
npm run dev
```

The app has no meaningful standalone UI — `/add-item` is a Marketplace Custom Field
extension route, embedded in Sitecore Pages inside an iframe, not opened directly in a
browser (same convention as
[`Sitecore/marketplace-starter`](https://github.com/Sitecore/marketplace-starter)).

## Testing

```sh
npm test              # unit tests (Vitest) — pure business-logic/parsing modules,
                       # no network or credentials needed
npm run lint
npx tsc --noEmit
```

`src/lib/sitecore/{fieldValue,parseFieldSource,resolveNewItem,queries}.test.ts` cover
the field-value parsing and the local/global + template resolution rules. There's no
live-integration test script (unlike the sibling `sitecore-ai-validator` project's
`test:checks`) since exercising this end-to-end needs a real Sitecore instance with
the app registered — see [Verification](#verification).

## Verification

After registering the app against a real XM Cloud sandbox (see
[Sitecore-side setup](#sitecore-side-setup)):

1. Open a page whose template has the companion "Add item" field next to a
   Multilist/TreelistEx field with at least one item already selected.
2. Click "Open app", confirm the existing selection renders as cards with correct
   Local/Shared badges.
3. Use "Add item" with a name only (no copy) — confirm a new sibling item is created
   with the same template as the existing selection, and it appears pre-selected in
   the real field without a manual Save.
4. Use "Add item" with "Copy fields from an existing item" — confirm the new item has
   the copied item's field values.
5. Confirm the real field's GraphQL/Layout Service behavior is unaffected (query it via
   Experience Edge or your site's existing rendering) — its Type should be untouched.
