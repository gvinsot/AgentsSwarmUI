import fetch from 'node-fetch';

export interface MicrosoftTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
}

export interface MicrosoftProfile {
  microsoftId: string;
  email: string;
  username: string;
  name: string | null;
}

/**
 * Get the OAuth credentials. Reuses the existing OneDrive Microsoft Entra app
 * (ONEDRIVE_CLIENT_ID / ONEDRIVE_CLIENT_SECRET) — the same Microsoft tenant
 * registration that powers the OneDrive plugin can also issue login tokens,
 * provided the login callback URL is registered alongside the OneDrive one.
 */
function getCreds(): { clientId: string; clientSecret: string } {
  const clientId = process.env.ONEDRIVE_CLIENT_ID;
  const clientSecret = process.env.ONEDRIVE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Microsoft OAuth not configured');
  }
  return { clientId, clientSecret };
}

export function isMicrosoftOAuthConfigured(): boolean {
  return Boolean(process.env.ONEDRIVE_CLIENT_ID && process.env.ONEDRIVE_CLIENT_SECRET);
}

export function getMicrosoftClientId(): string | null {
  return process.env.ONEDRIVE_CLIENT_ID || null;
}

export async function exchangeMicrosoftCodeForToken(code: string, redirectUri: string): Promise<MicrosoftTokenResponse> {
  const { clientId, clientSecret } = getCreds();
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    scope: 'openid profile email User.Read offline_access',
  });
  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Microsoft token exchange failed: ${response.status} ${text}`);
  }
  const data = (await response.json()) as any;
  if (!data.access_token) {
    throw new Error('Microsoft returned no access_token');
  }
  return data as MicrosoftTokenResponse;
}

/**
 * Fetches the user profile from Microsoft Graph /me. Uses the User.Read scope
 * granted at sign-in. Falls back across mail/userPrincipalName because Graph
 * does not always populate `mail` for personal Microsoft accounts.
 */
export async function fetchMicrosoftProfile(accessToken: string): Promise<MicrosoftProfile> {
  const response = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Microsoft profile fetch failed: ${response.status} ${text}`);
  }
  const data = (await response.json()) as any;
  const microsoftId: string | undefined = data.id;
  if (!microsoftId) {
    throw new Error('Microsoft Graph returned no id');
  }
  const email: string = data.mail || data.userPrincipalName || '';
  if (!email) {
    throw new Error('Microsoft Graph returned no email/userPrincipalName');
  }
  // Use the local-part of the email as a username seed.
  const username: string = (email.split('@')[0] || data.displayName || `msuser_${microsoftId.slice(0, 8)}`)
    .replace(/[^a-zA-Z0-9_.-]/g, '_');
  return {
    microsoftId,
    email,
    username,
    name: data.displayName || null,
  };
}