'use client';

import { useEffect, useState } from 'react';
import { ClientSDK } from '@sitecore-marketplace-sdk/client';
import { XMC } from '@sitecore-marketplace-sdk/xmc';

/**
 * The base `@sitecore-marketplace-sdk/client` package only ships the
 * `pages.context` / `application.context` query keys and a couple of
 * page-navigation mutations. `xmc.authoring.graphql` (used for every
 * Authoring & Management API call in this app) is contributed by the
 * `@sitecore-marketplace-sdk/xmc` package's `XMC` module, registered here via
 * `modules: [XMC]` — without it, `client.mutate('xmc.authoring.graphql', ...)`
 * doesn't exist. Confirmed by reading both packages' shipped .d.ts files.
 */
let clientPromise: Promise<ClientSDK> | null = null;

function initClient(): Promise<ClientSDK> {
  if (!clientPromise) {
    clientPromise = ClientSDK.init({
      target: window.parent,
      modules: [XMC],
    });
  }
  return clientPromise;
}

export function useMarketplaceClient() {
  const [client, setClient] = useState<ClientSDK | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    initClient()
      .then((c) => {
        if (!cancelled) setClient(c);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { client, error };
}

/**
 * `application.context.resourceAccess[0].context.preview` is the draft/authoring
 * Sitecore context id, as opposed to `.live` (the published/delivery one) — we
 * always want `preview` here since this app writes unsaved content.
 */
export async function getSitecoreContextId(client: ClientSDK): Promise<string> {
  const { data } = await client.query('application.context');
  const resource = data?.resourceAccess?.[0];
  // `.preview` (draft/authoring context) is preferred since this app writes
  // unsaved content, but fall back to `.live` rather than fail outright —
  // the SDK's shipped types promise both are strings, but that's a contract,
  // not a guarantee of what a given tenant actually populates.
  const contextId = resource?.context?.preview || resource?.context?.live;
  if (!contextId) {
    console.error('application.context response:', data);
    throw new Error(
      'Could not resolve a Sitecore context id from application.context. ' +
        `resourceAccess: ${JSON.stringify(data?.resourceAccess ?? [])}. ` +
        'Check the browser console for the full response, and confirm an ' +
        'environment is linked to this app in Cloud Portal (App access > ' +
        'your installed app).',
    );
  }
  return contextId;
}

export interface CurrentItemUpdate {
  itemId: string;
  language: string;
  itemVersion: number;
}

export interface CurrentPageContext extends CurrentItemUpdate {
  path: string;
  /**
   * Raw JSON string of the page's rendering tree (devices/placeholders/
   * renderings, each optionally with a `dataSource` item id) — see
   * `presentationDetails.ts` for parsing. Used to deterministically find a
   * component's datasource item without depending on the unreliable
   * fieldsUpdated event.
   */
  presentationDetails: string | null;
}

/**
 * pages.context.pageInfo is the *page* item being edited — confirmed against
 * a real tenant to stay the page even when a Custom Field is open for a
 * component's datasource item elsewhere on that page. Reliable and always
 * available, unlike `pages.content.fieldsUpdated` (which can carry a
 * component's datasource id, but was confirmed to be change-driven, not a
 * "give me the current item" signal — it didn't fire at all on a load where
 * nothing had changed, so it's not used here). Instead, `presentationDetails`
 * — the page's rendering tree, each rendering optionally with a `dataSource`
 * item id — lets page.tsx deterministically find the actual target item by
 * checking which candidate item has the field in question, rather than
 * guessing from an unreliable event. This also doubles as the source of the
 * page's own path, for the "local vs. global" rule (see resolveNewItem.ts).
 */
export async function getCurrentPageContext(client: ClientSDK): Promise<CurrentPageContext> {
  const { data } = await client.query('pages.context');
  const pageInfo = data?.pageInfo;
  if (!pageInfo?.id || !pageInfo?.path) {
    throw new Error('Could not resolve the current page from pages.context.pageInfo.');
  }
  return {
    itemId: pageInfo.id,
    path: pageInfo.path,
    language: pageInfo.language ?? 'en',
    itemVersion: pageInfo.version ?? 1,
    presentationDetails:
      typeof pageInfo.presentationDetails === 'string' ? pageInfo.presentationDetails : null,
  };
}

/**
 * This app writes directly to the Authoring API, bypassing Sitecore's own
 * field-editing flow entirely — so the Pages canvas (including the native
 * Multilist/TreelistEx field widget showing the current selection) has no
 * reason to know anything changed. `pages.reloadCanvas` is the documented
 * mutation for forcing it to refresh after an out-of-band change like this.
 */
export async function reloadPagesCanvas(client: ClientSDK): Promise<void> {
  await client.mutate('pages.reloadCanvas');
}

export interface AuthoringGraphqlError {
  message?: string;
  path?: Array<string | number>;
  locations?: Array<{ line?: number; column?: number }>;
  extensions?: Record<string, unknown>;
}

export interface AuthoringGraphqlResult<T> {
  data?: T;
  errors?: AuthoringGraphqlError[];
}

export async function authoringGraphql<T = Record<string, unknown>>(
  client: ClientSDK,
  sitecoreContextId: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const result = await client.mutate('xmc.authoring.graphql', {
    params: {
      body: { query, variables },
      query: { sitecoreContextId },
    },
  });

  const payload = result.data as AuthoringGraphqlResult<T> | undefined;
  if (payload?.errors?.length) {
    // The `path`/`extensions` on a GraphQL error point at exactly which
    // field/argument the server rejected — the message alone (e.g.
    // HotChocolate's "Unable to convert type from `String` to
    // `Nullable`1`") doesn't say which variable it was, so log the query,
    // variables and full error objects together rather than just the message.
    console.error('Authoring API error', { query, variables, errors: payload.errors });
    throw new Error(
      `Authoring API returned errors: ${payload.errors
        .map((e) => `${e.message ?? 'unknown error'}${e.path ? ` (at ${e.path.join('.')})` : ''}`)
        .join('; ')}`,
    );
  }
  if (!payload?.data) {
    throw new Error('Authoring API response had no data.');
  }

  return payload.data;
}
