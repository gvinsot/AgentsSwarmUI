import test from 'node:test';
import assert from 'node:assert/strict';
import { getGoogleOAuthConfig } from '../googleOAuthConfig.js';

const KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'];

function reset() {
  for (const k of KEYS) delete process.env[k];
}

test('returns null when nothing is configured', () => {
  reset();
  assert.equal(getGoogleOAuthConfig(), null);
});

test('returns config when all three GOOGLE_* env vars are set', () => {
  reset();
  process.env.GOOGLE_CLIENT_ID = 'shared-id';
  process.env.GOOGLE_CLIENT_SECRET = 'shared-secret';
  process.env.GOOGLE_REDIRECT_URI = 'https://example.com/api/google/oauth-redirect';

  const cfg = getGoogleOAuthConfig();
  assert.ok(cfg);
  assert.equal(cfg!.clientId, 'shared-id');
  assert.equal(cfg!.clientSecret, 'shared-secret');
  assert.equal(cfg!.redirectUri, 'https://example.com/api/google/oauth-redirect');
});

test('returns null when any required field is missing', () => {
  reset();
  process.env.GOOGLE_CLIENT_ID = 'id';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  // missing redirect URI
  assert.equal(getGoogleOAuthConfig(), null);
});
