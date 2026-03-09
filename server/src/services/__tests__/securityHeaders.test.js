import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

test('server index sets restrictive CSP with required connect/style sources', () => {
  const source = fs.readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
  assert.match(source, /Content-Security-Policy/);
  assert.match(source, /connect-src 'self' wss: ws: https:\\/\\/api\\.openai\\.com https:\\/\\/fonts\\.googleapis\\.com https:\\/\\/fonts\\.gstatic\\.com/);
  assert.match(source, /style-src 'self' 'unsafe-inline' https:\\/\\/fonts\\.googleapis\\.com/);
});