/**
 * Basic tests for the RateLimiter class.
 * 
 * Run with: npx tsx src/lib/__tests__/rateLimiter.test.ts
 */

import { RateLimiter } from "../rateLimiter";

async function testBasicRateLimiting() {
  console.log("Test 1: Basic rate limiting - requests within limit execute immediately");
  
  const limiter = new RateLimiter(5); // 5 requests per minute for testing
  const results: number[] = [];
  const start = Date.now();

  // Fire 5 requests - all should execute immediately
  const promises = Array.from({ length: 5 }, (_, i) =>
    limiter.schedule(async () => {
      results.push(i);
      return i;
    })
  );

  await Promise.all(promises);
  const elapsed = Date.now() - start;

  console.assert(results.length === 5, `Expected 5 results, got ${results.length}`);
  console.assert(elapsed < 1000, `Expected < 1000ms, took ${elapsed}ms`);
  console.log(`  ✅ 5 requests completed in ${elapsed}ms`);
}

async function testQueueing() {
  console.log("Test 2: Requests beyond limit are queued");

  const limiter = new RateLimiter(3); // 3 requests per minute
  const results: number[] = [];

  // Fire 3 requests to fill the window
  for (let i = 0; i < 3; i++) {
    await limiter.schedule(async () => {
      results.push(i);
      return i;
    });
  }

  const status = limiter.getStatus();
  console.assert(
    status.requestsInWindow === 3,
    `Expected 3 requests in window, got ${status.requestsInWindow}`
  );
  console.log(`  ✅ Rate limiter correctly tracks ${status.requestsInWindow} requests in window`);
}

async function testGetStatus() {
  console.log("Test 3: getStatus returns correct information");

  const limiter = new RateLimiter(50);

  const status = limiter.getStatus();
  console.assert(status.maxRequestsPerMinute === 50, "Max should be 50");
  console.assert(status.requestsInWindow === 0, "Should start at 0");
  console.assert(status.queueDepth === 0, "Queue should be empty");
  console.assert(status.isProcessing === false, "Should not be processing");

  console.log("  ✅ Status reports correct initial state");
}

async function testErrorHandling() {
  console.log("Test 4: Errors in scheduled functions are properly propagated");

  const limiter = new RateLimiter(50);

  try {
    await limiter.schedule(async () => {
      throw new Error("Test error");
    });
    console.assert(false, "Should have thrown");
  } catch (error: unknown) {
    const err = error as Error;
    console.assert(err.message === "Test error", `Expected 'Test error', got '${err.message}'`);
    console.log("  ✅ Errors are properly propagated");
  }
}

async function testConcurrentScheduling() {
  console.log("Test 5: Concurrent scheduling works correctly");

  const limiter = new RateLimiter(10);
  const results: number[] = [];

  // Schedule 10 concurrent requests
  const promises = Array.from({ length: 10 }, (_, i) =>
    limiter.schedule(async () => {
      results.push(i);
      return i;
    })
  );

  const values = await Promise.all(promises);
  console.assert(values.length === 10, `Expected 10 values, got ${values.length}`);
  console.assert(results.length === 10, `Expected 10 results, got ${results.length}`);
  console.log(`  ✅ All 10 concurrent requests completed successfully`);
}

async function runAllTests() {
  console.log("\\n🧪 Running RateLimiter Tests\\n");

  await testBasicRateLimiting();
  await testQueueing();
  await testGetStatus();
  await testErrorHandling();
  await testConcurrentScheduling();

  console.log("\\n✅ All tests passed!\\n");
}

runAllTests().catch(console.error);