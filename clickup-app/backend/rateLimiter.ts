/**
 * Sliding-window rate limiter for outbound ClickUp API calls.
 *
 * ClickUp allows 100 requests/minute per token; we self-limit below that so
 * bursts (large exports, order sheets with many parcels) queue up instead of
 * triggering 429s. The window is global across all users of this server —
 * conservative now that tokens are per-user, but simple and safe.
 */

const TIME_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 90;

class RateLimiter {
    private timestamps: number[] = [];

    private prune(now: number) {
        this.timestamps = this.timestamps.filter(t => now - t < TIME_WINDOW_MS);
    }

    /** Resolves once the request is allowed to proceed, waiting if necessary. */
    async recordRequest(_endpointKey: string): Promise<void> {
        for (;;) {
            const now = Date.now();
            this.prune(now);
            if (this.timestamps.length < MAX_REQUESTS_PER_WINDOW) {
                this.timestamps.push(now);
                return;
            }
            // Wait until the oldest request ages out of the window
            const waitMs = TIME_WINDOW_MS - (now - this.timestamps[0]) + 50;
            await new Promise(resolve => setTimeout(resolve, waitMs));
        }
    }

    getStatus() {
        this.prune(Date.now());
        return {
            currentCount: this.timestamps.length,
            maxRequests: MAX_REQUESTS_PER_WINDOW,
            timeWindow: TIME_WINDOW_MS,
        };
    }
}

export const rateLimiter = new RateLimiter();
