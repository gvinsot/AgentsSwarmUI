import test from 'node:test';
import assert from 'node:assert/strict';
import { generateGoogleOAuthState, consumeGoogleOAuthState } from '../../routes/googleOAuth.js';

test('state round-trips service + scope fields', () => {
  const s = generateGoogleOAuthState('gdrive', 'alice', 'agent-1', 'board-2');
  const out = consumeGoogleOAuthState(s);
  assert.ok(out);
  assert.equal(out!.service, 'gdrive');
  assert.equal(out!.username, 'alice');
  assert.equal(out!.agentId, 'agent-1');
  assert.equal(out!.boardId, 'board-2');
});

test('state is one-shot — second consume returns null', () => {
  const s = generateGoogleOAuthState('gmail', 'bob');
  assert.ok(consumeGoogleOAuthState(s));
  assert.equal(consumeGoogleOAuthState(s), null);
});

test('two services issue independent states', () => {
  const a = generateGoogleOAuthState('gmail', 'u');
  const b = generateGoogleOAuthState('gdrive', 'u');
  assert.notEqual(a, b);
  assert.equal(consumeGoogleOAuthState(a)!.service, 'gmail');
  assert.equal(consumeGoogleOAuthState(b)!.service, 'gdrive');
});

test('unknown state returns null', () => {
  assert.equal(consumeGoogleOAuthState('not-a-real-state'), null);
});

test('default agentId/boardId are null', () => {
  const s = generateGoogleOAuthState('gmail', 'user');
  const out = consumeGoogleOAuthState(s)!;
  assert.equal(out.agentId, null);
  assert.equal(out.boardId, null);
});
