import type { Context, Middleware } from "../../../core/src";
import { RateLimiter, Algorithm } from "@rabbit-company/rate-limiter";
import type { RateLimitConfig, RateLimitResult } from "@rabbit-company/rate-limiter";

/**
 * Rate limiting options for middleware.
 */
export interface RateLimitOptions<T extends Record<string, unknown>> {
	/**
	 * Rate limiting algorithm to use (Fixed Window, Sliding Window, Token Bucket).
	 */
	algorithm?: Algorithm;
	/**
	 * Time window in milliseconds for fixed or sliding window algorithms.
	 */
	windowMs?: number;
	/**
	 * Maximum number of requests allowed per window or token bucket capacity.
	 */
	max?: number;

	/**
	 * Refill rate for token bucket algorithm (tokens per interval).
	 */
	refillRate?: number;
	/**
	 * Interval in milliseconds at which tokens are refilled in token bucket.
	 */
	refillInterval?: number;

	/**
	 * Precision in milliseconds for sliding window algorithm.
	 */
	precision?: number;

	/**
	 * Message to return when rate limited.
	 */
	message?: string;
	/**
	 * HTTP status code to return when rate limited.
	 */
	statusCode?: number;
	/**
	 * Whether to include rate limit headers in the response.
	 */
	headers?: boolean;

	/**
	 * Function to generate a unique key (e.g., per IP or user).
	 */
	keyGenerator?: (ctx: Context<T>) => string;
	/**
	 * Function to generate a rate-limited endpoint identifier.
	 */
	endpointGenerator?: (ctx: Context<T>) => string;
	/**
	 * Function to skip rate limiting conditionally.
	 */
	skip?: (ctx: Context<T>) => boolean | Promise<boolean>;

	/**
	 * How often expired records should be cleaned up.
	 */
	cleanupInterval?: number;
	/**
	 * Whether to enable automatic cleanup of expired rate limits.
	 */
	enableCleanup?: boolean;

	/**
	 * Provide an external/shared rate limiter instance.
	 */
	rateLimiter?: RateLimiter;
}

/**
 * Creates a rate limiting middleware using @rabbit-company/rate-limiter
 *
 * @example
 * ```typescript
 * // Basic usage with default settings
 * app.use(rateLimit());
 *
 * // Custom configuration with fixed window
 * app.use(rateLimit({
 *   windowMs: 15 * 60 * 1000, // 15 minutes
 *   max: 100, // limit each IP to 100 requests per windowMs
 *   message: "Too many requests from this IP"
 * }));
 *
 * // Using sliding window algorithm
 * app.use(rateLimit({
 *   algorithm: Algorithm.SLIDING_WINDOW,
 *   windowMs: 60 * 1000, // 1 minute
 *   max: 60, // 60 requests per minute
 *   precision: 100 // 100ms precision
 * }));
 *
 * // Using token bucket for burst handling
 * app.use(rateLimit({
 *   algorithm: Algorithm.TOKEN_BUCKET,
 *   max: 10, // bucket capacity
 *   refillRate: 2, // 2 tokens per interval
 *   refillInterval: 1000 // refill every second
 * }));
 *
 * // Route-specific rate limiting
 * app.post('/api/login', rateLimit({
 *   windowMs: 15 * 60 * 1000, // 15 minutes
 *   max: 5, // limit each IP to 5 requests per windowMs
 *   message: "Too many login attempts"
 * }));
 *
 * // Custom key generation (e.g., by user ID instead of IP)
 * app.use('/api', rateLimit({
 *   keyGenerator: (ctx) => ctx.get('userId') || 'anonymous',
 *   endpointGenerator: (ctx) => ctx.req.method + ':' + ctx.req.url
 * }));
 *
 * // Skip rate limiting for certain requests
 * app.use(rateLimit({
 *   skip: async (ctx) => {
 *     // Skip rate limiting for authenticated admins
 *     const user = ctx.get('user');
 *     return user?.role === 'admin';
 *   }
 * }));
 * ```
 */
export function rateLimit<T extends Record<string, unknown> = Record<string, unknown>>(options: RateLimitOptions<T> = {}): Middleware<T> {
	const {
		// Algorithm configuration
		algorithm = Algorithm.FIXED_WINDOW,
		windowMs = 60 * 1000, // 1 minute default
		max = 60, // 60 requests per minute default

		// Token bucket options
		refillRate = 1,
		refillInterval = 1000,

		// Sliding window options
		precision = 100,

		// Response configuration
		message = "Too many requests",
		statusCode = 429,
		headers = true,

		// Key generation
		keyGenerator = defaultKeyGenerator,
		endpointGenerator = defaultEndpointGenerator,
		skip,

		// Cleanup configuration
		cleanupInterval = 30 * 1000, // 30 seconds
		enableCleanup = true,

		// Custom instance
		rateLimiter,
	} = options;

	// Create or use provided rate limiter instance
	const limiter =
		rateLimiter ||
		new RateLimiter({
			algorithm,
			window: windowMs,
			max,
			refillRate,
			refillInterval,
			precision,
			cleanupInterval,
			enableCleanup,
		} as RateLimitConfig);

	return async (ctx: Context<T>, next) => {
		// Check if this request should skip rate limiting
		if (skip && (await skip(ctx))) {
			return next();
		}

		// Generate unique key for this request
		const identifier = keyGenerator(ctx);
		const endpoint = endpointGenerator(ctx);

		// Check rate limit
		const result: RateLimitResult = limiter.check(endpoint, identifier);

		// Always set rate limit headers if enabled
		if (headers) {
			ctx.header("RateLimit-Limit", result.limit.toString());
			ctx.header("RateLimit-Remaining", result.remaining.toString());
			ctx.header("RateLimit-Reset", Math.ceil(result.reset / 1000).toString());

			// Add algorithm info header
			ctx.header("RateLimit-Algorithm", algorithm);
		}

		// If rate limited, return error response
		if (result.limited) {
			const retryAfter = Math.ceil((result.reset - Date.now()) / 1000);

			if (headers) {
				ctx.header("Retry-After", retryAfter.toString());
			}

			return ctx.json(
				{
					error: message,
					retryAfter: retryAfter,
					limit: result.limit,
					window: result.window,
					reset: new Date(result.reset).toISOString(),
				},
				statusCode
			);
		}

		// Continue to next middleware
		return next();
	};
}

/**
 * Default key generator that extracts client identifier from request.
 * Prioritizes: X-Forwarded-For > X-Real-IP > CF-Connecting-IP > Remote Address > "unknown".
 *
 * @param ctx - The request context
 * @returns A string identifying the requester
 */
function defaultKeyGenerator<T extends Record<string, unknown>>(ctx: Context<T>): string {
	// Check for forwarded IPs (common in proxied environments)
	const forwarded = ctx.req.headers.get("X-Forwarded-For");
	if (forwarded) {
		// X-Forwarded-For can contain multiple IPs, take the first one
		return forwarded.split(",")[0].trim();
	}

	// Check other common headers
	const realIp = ctx.req.headers.get("X-Real-IP");
	if (realIp) return realIp;

	// Cloudflare specific header
	const cfIp = ctx.req.headers.get("CF-Connecting-IP");
	if (cfIp) return cfIp;

	// Try to get remote address from the request
	// Note: This might need adjustment based on your server setup
	const remoteAddr = (ctx.req as any).connection?.remoteAddress || (ctx.req as any).socket?.remoteAddress || (ctx.req as any).info?.remoteAddress;
	if (remoteAddr) return remoteAddr;

	// Fallback
	return "unknown";
}

/**
 * Default endpoint generator that combines HTTP method and pathname.
 *
 * @param ctx - The request context
 * @returns A unique identifier for the endpoint
 */
function defaultEndpointGenerator<T extends Record<string, unknown>>(ctx: Context<T>): string {
	try {
		const url = new URL(ctx.req.url);
		return `${ctx.req.method}:${url.pathname}`;
	} catch {
		// Fallback if URL parsing fails
		return `${ctx.req.method}:${ctx.req.url}`;
	}
}

/**
 * Creates a shared rate limiter instance that can be used across multiple middleware
 * Useful for implementing global rate limits or sharing limits between routes
 *
 * @example
 * ```typescript
 * // Create a shared limiter for API endpoints
 * const apiLimiter = createRateLimiter({
 *   algorithm: Algorithm.SLIDING_WINDOW,
 *   windowMs: 60 * 1000,
 *   max: 100
 * });
 *
 * // Use the same limiter for multiple routes
 * app.use('/api/users', rateLimit({ rateLimiter: apiLimiter }));
 * app.use('/api/posts', rateLimit({ rateLimiter: apiLimiter }));
 *
 * // Get limiter statistics
 * console.log(`Active limits: ${apiLimiter.getSize()}`);
 * ```
 */
export function createRateLimiter(config?: Partial<RateLimitConfig>): RateLimiter {
	return new RateLimiter(config);
}

/**
 * Utility function to create a key generator based on multiple factors
 *
 * @example
 * ```typescript
 * const keyGen = createKeyGenerator({
 *   useIp: true,
 *   useUserId: true,
 *   useSessionId: false,
 *   custom: (ctx) => ctx.req.headers.get('API-Key')
 * });
 *
 * app.use(rateLimit({ keyGenerator: keyGen }));
 * ```
 */
export function createKeyGenerator<T extends Record<string, unknown>>(options: {
	useIp?: boolean;
	useUserId?: boolean;
	useSessionId?: boolean;
	custom?: (ctx: Context<T>) => string | null;
}): (ctx: Context<T>) => string {
	const { useIp = true, useUserId = false, useSessionId = false, custom } = options;

	return (ctx: Context<T>): string => {
		const parts: string[] = [];

		if (useIp) {
			parts.push(defaultKeyGenerator(ctx));
		}

		if (useUserId) {
			const userId = ctx.get("userId" as keyof T);
			if (userId) parts.push(`user:${userId}`);
		}

		if (useSessionId) {
			const sessionId = ctx.get("sessionId" as keyof T) || ctx.req.headers.get("X-Session-ID");
			if (sessionId) parts.push(`session:${sessionId}`);
		}

		if (custom) {
			const customKey = custom(ctx);
			if (customKey) parts.push(customKey);
		}

		return parts.length > 0 ? parts.join(":") : "unknown";
	};
}

export { Algorithm } from "@rabbit-company/rate-limiter";
export type { RateLimiter, RateLimitResult } from "@rabbit-company/rate-limiter";
