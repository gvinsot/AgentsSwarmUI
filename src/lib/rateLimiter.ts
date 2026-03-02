/**
 * Rate Limiter for Claude API calls
 * 
 * Ensures that calls to the Claude/Anthropic API do not exceed
 * a configurable number of requests per minute (default: 50).
 * Requests that exceed the limit are queued and delayed automatically.
 */

interface QueuedRequest<T> {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  enqueuedAt: number;
}

export class RateLimiter {
  private maxRequestsPerMinute: number;
  private timestamps: number[] = [];
  private queue: QueuedRequest<unknown>[] = [];
  private processing = false;
  private windowMs: number;

  /**
   * @param maxRequestsPerMinute - Maximum number of requests allowed per minute (default: 50)
   */
  constructor(maxRequestsPerMinute = 50) {
    this.maxRequestsPerMinute = maxRequestsPerMinute;
    this.windowMs = 60_000; // 1 minute in ms
  }

  /**
   * Clean up timestamps older than the sliding window
   */
  private pruneTimestamps(): void {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    // Remove timestamps that have fallen outside the window
    while (this.timestamps.length > 0 && this.timestamps[0] <= cutoff) {
      this.timestamps.shift();
    }
  }

  /**
   * Calculate how long to wait before the next request can be made.
   * Returns 0 if a request can be made immediately.
   */
  private getWaitTime(): number {
    this.pruneTimestamps();

    if (this.timestamps.length < this.maxRequestsPerMinute) {
      return 0;
    }

    // We need to wait until the oldest timestamp in the window expires
    const oldestInWindow = this.timestamps[0];
    const waitTime = oldestInWindow + this.windowMs - Date.now() + 1; // +1ms buffer
    return Math.max(0, waitTime);
  }

  /**
   * Record a request timestamp
   */
  private recordRequest(): void {
    this.timestamps.push(Date.now());
  }

  /**
   * Process the queue of pending requests
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const waitTime = this.getWaitTime();

        if (waitTime > 0) {
          console.log(
            `[RateLimiter] Rate limit reached (${this.timestamps.length}/${this.maxRequestsPerMinute} req/min). ` +
            `Delaying next request by ${waitTime}ms. Queue depth: ${this.queue.length}`
          );
          await this.delay(waitTime);
        }

        const item = this.queue.shift();
        if (!item) break;

        this.recordRequest();

        try {
          const result = await item.execute();
          item.resolve(result);
        } catch (error) {
          item.reject(error);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Delay execution for a given number of milliseconds
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Schedule a function to be executed within the rate limit.
   * If the rate limit has been reached, the request is queued and
   * will be executed once a slot becomes available.
   * 
   * @param fn - The async function to execute (e.g., an API call)
   * @returns The result of the function
   */
  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        execute: fn,
        resolve: resolve as (value: unknown) => void,
        reject,
        enqueuedAt: Date.now(),
      });

      // Kick off processing (no-op if already running)
      this.processQueue();
    });
  }

  /**
   * Get current status of the rate limiter
   */
  getStatus(): {
    requestsInWindow: number;
    maxRequestsPerMinute: number;
    queueDepth: number;
    isProcessing: boolean;
  } {
    this.pruneTimestamps();
    return {
      requestsInWindow: this.timestamps.length,
      maxRequestsPerMinute: this.maxRequestsPerMinute,
      queueDepth: this.queue.length,
      isProcessing: this.processing,
    };
  }
}

/**
 * Singleton rate limiter instance for Claude API calls.
 * Configured to allow a maximum of 50 requests per minute.
 */
const CLAUDE_MAX_REQUESTS_PER_MINUTE = parseInt(
  process.env.CLAUDE_RATE_LIMIT_PER_MINUTE || '50',
  10
);

export const claudeRateLimiter = new RateLimiter(CLAUDE_MAX_REQUESTS_PER_MINUTE);

export default claudeRateLimiter;