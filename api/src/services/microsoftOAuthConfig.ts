import { readSecret } from '../secrets.js';

/**
 * Shared Microsoft OAuth client config for OneDrive, Outlook, Microsoft login,
 * and any future Microsoft Graph plugin (Teams, SharePoint, …).
 *
 * Microsoft issues one app registration per Azure AD tenant; the same
 * client_id / client_secret pair and a single registered redirect URI work
 * for every Microsoft Graph scope. The originating plugin is encoded in the
 * OAuth `state` parameter, so a single callback handler can dispatch tokens
 * to the right provider — mirrors the Gmail/Drive unification under
 * api/src/services/googleOAuthConfig.ts.
 *
 * Env vars:
 *   MICROSOFT_CLIENT_ID
 *   MICROSOFT_CLIENT_SECRET
 *   MICROSOFT_REDIRECT_URI
 *   MICROSOFT_TENANT_ID (optional — defaults to "common" for personal + work accounts)
 *
 * The redirect URI must be registered in the Azure App registration.
 */

export interface MicrosoftOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tenantId: string;
}

export function getMicrosoftOAuthConfig(): MicrosoftOAuthConfig | null {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = readSecret('MICROSOFT_CLIENT_SECRET');
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI;
  const tenantId = process.env.MICROSOFT_TENANT_ID || 'common';

  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri, tenantId };
}
