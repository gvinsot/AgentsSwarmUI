import test from 'node:test';
import assert from 'node:assert/strict';
import { getGoogleOAuthConfig } from '../googleOAuthConfig.js';

const KEYS = [
  'GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REDIRECT_URI',
  'GDRIVE_CLIENT_ID', 'GDRIVE_CLIENT_SECRET', 'GDRIVE_REDIRECT_URI',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI',
];

function reset() {
  for (const k of KEYS) delete process.env[k];
}

test('returns null when nothing is configured', () => {
  reset();
  assert.equal(getGoogleOAuthConfig(), null);
});

test('GOOGLE_* values take precedence', () => {
  reset();
  process.env.GOOGLE_CLIENT_ID = 'shared-id';
  process.env.GOOGLE_CLIENT_SECRET = 'shared-secret';
  process.env.GOOGLE_REDIRECT_URI = 'https://example.com/api/google/oauth-redirect';
  process.env.GMAIL_CLIENT_ID = 'gmail-id';
  process.env.GDRIVE_CLIENT_ID = 'drive-id';

  const cfg = getGoogleOAuthConfig();
  assert.ok(cfg);
  assert.equal(cfg!.clientId, 'shared-id');
  assert.equal(cfg!.clientSecret, 'shared-secret');
  assert.equal(cfg!.redirectUri, 'https://example.com/api/google/oauth-redirect');
});

test('falls back to GMAIL_* when GOOGLE_* not set', () => {
  reset();
  process.env.GMAIL_CLIENT_ID = 'gmail-id';
  process.env.GMAIL_CLIENT_SECRET = 'gmail-secret';
  process.env.GMAIL_REDIRECT_URI = 'https://example.com/gmail-callback.html';

  const cfg = getGoogleOAuthConfig();
  assert.equal(cfg!.clientId, 'gmail-id');
  assert.equal(cfg!.clientSecret, 'gmail-secret');
  assert.equal(cfg!.redirectUri, 'https://example.com/gmail-callback.html');
});

test('falls back to GDRIVE_* when neither GOOGLE_* nor GMAIL_* are set', () => {
  reset();
  process.env.GDRIVE_CLIENT_ID = 'drive-id';
  process.env.GDRIVE_CLIENT_SECRET = 'drive-secret';
  process.env.GDRIVE_REDIRECT_URI = 'https://example.com/api/gdrive/oauth-redirect';

  const cfg = getGoogleOAuthConfig();
  assert.equal(cfg!.clientId, 'drive-id');
  assert.equal(cfg!.clientSecret, 'drive-secret');
  assert.equal(cfg!.redirectUri, 'https://example.com/api/gdrive/oauth-redirect');
});

test('fields resolve independently — can mix GMAIL_ id with GOOGLE_ redirect', () => {
  reset();
  process.env.GMAIL_CLIENT_ID = 'gmail-id';
  process.env.GMAIL_CLIENT_SECRET = 'gmail-secret';
  process.env.GOOGLE_REDIRECT_URI = 'https://example.com/api/google/oauth-redirect';

  const cfg = getGoogleOAuthConfig();
  assert.equal(cfg!.clientId, 'gmail-id');
  assert.equal(cfg!.clientSecret, 'gmail-secret');
  assert.equal(cfg!.redirectUri, 'https://example.com/api/google/oauth-redirect');
});

test('returns null when any required field is missing', () => {
  reset();
  process.env.GOOGLE_CLIENT_ID = 'id';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  // missing redirect URI
  assert.equal(getGoogleOAuthConfig(), null);
});
