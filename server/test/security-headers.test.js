import assert from "node:assert/strict";
import test from "node:test";

import { buildContentSecurityPolicy, createApp } from "../src/app.js";

test("buildContentSecurityPolicy allows Google Fonts and OpenAI realtime", () => {
  const csp = buildContentSecurityPolicy();

  assert.match(
    csp,
    /style-src 'self' 'unsafe-inline' https:\\/\\/fonts\\.googleapis\\.com/,
  );
  assert.match(
    csp,
    /style-src-elem 'self' 'unsafe-inline' https:\\/\\/fonts\\.googleapis\\.com/,
  );
  assert.match(
    csp,
    /font-src 'self' data: https:\\/\\/fonts\\.gstatic\\.com/,
  );
  assert.match(csp, /connect-src 'self' ws: wss: https:\\/\\/api\\.openai\\.com/);
});

test("GET /health returns security headers with required CSP allowances", async (t) => {
  const app = createApp();
  const server = app.listen(0);

  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
  );

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Expected an ephemeral TCP port for the test server.");
  }

  const response = await fetch(`http://127.0.0.1:${address.port}/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  const csp = response.headers.get("content-security-policy");

  assert.ok(csp);
  assert.match(csp, /https:\\/\\/fonts\\.googleapis\\.com/);
  assert.match(csp, /https:\\/\\/fonts\\.gstatic\\.com/);
  assert.match(csp, /https:\\/\\/api\\.openai\\.com/);
});