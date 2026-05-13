import { readSecret } from '../secrets.js';

/**
 * Shared Microsoft OAuth client config for OneDrive and any future Microsoft
 * Graph plugin (Outlook, Teams, SharePoint, ...).
 *
 * Microsoft issues one app registration per Azure AD tenant; the same
 * client_id / client_secret pair and a single registered redirect URI work
 * for every Microsoft Graph scope. The originating plugin is encoded in the
 * OAuth `state` parameter, so a single callback handler can dispatch tokens
 * to the right provider — mirrors the Gmail/Drive unification under
 * api/src/services/googleOAuthConfig.ts.
 *
 * Resolution order (first non-empty wins, per field):
 *   1. MICROSOFT_CLIENT_ID  / MICROSOFT_CLIENT_SECRET  / MICROSOFT_REDIRECT_URI  / MICROSOFT_TENANT_ID  (preferred)
 *   2. ONEDRIVE_CLIENT_ID   / ONEDRIVE_CLIENT_SECRET   / ONEDRIVE_REDIRECT_URI   / ONEDRIVE_TENANT_ID   (legacy)
 *
 * The redirect URI must be registered in the Azure App registration. The API
 * exposes the OAuth callback under both /api/microsoft/oauth-redirect
 * (preferred) and /api/onedrive/oauth-redirect (legacy alias) so existing
 * deployments keep working unchanged.
 */

export interface MicrosoftOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tenantId: string;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const v of values) if (v) return v;
  return undefined;
}

export function getMicrosoftOAuthConfig(): MicrosoftOAuthConfig | null {
  const clientId = firstNonEmpty(
    process.env.MICROSOFT_CLIENT_ID,
    process.env.ONEDRIVE_CLIENT_ID,
  );
  const clientSecret = firstNonEmpty(
    readSecret('MICROSOFT_CLIENT_SECRET'),
    readSecret('ONEDRIVE_CLIENT_SECRET'),
  );
  const redirectUri = firstNonEmpty(
    process.env.MICROSOFT_REDIRECT_URI,
    process.env.ONEDRIVE_REDIRECT_URI,
  );
  const tenantId = firstNonEmpty(
    process.env.MICROSOFT_TENANT_ID,
    process.env.ONEDRIVE_TENANT_ID,
  ) || 'common';

  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri, tenantId };
}
