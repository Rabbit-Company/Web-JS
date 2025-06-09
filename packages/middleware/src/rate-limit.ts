import type { Context, Middleware } from "@rabbit-company/web";
import { RateLimiter, Algorithm } from "@rabbit-company/rate-limiter";
import type { RateLimitConfig, RateLimitResult } from "@rabbit-company/rate-limiter";

/**
 * Configuration options for rate limiting middleware.
 *
 * @interface RateLimitOptions
 * @template T - Context state type
 *
 * @example
 * ```typescript
 * const options: RateLimitOptions = {
 *   algorithm: Algorithm.SLIDING_WINDOW,
 *   windowMs: 60000,
 *   max: 100,
 *   headers: true
 * };
 * ```
 */
export interface RateLimitOptions<T extends Record<string, unknown>> {
	/**
	 * Rate limiting algorithm to use.
	 *
	 * @default Algorithm.FIXED_WINDOW
	 *
	 * Available algorithms:
	 * - `FIXED_WINDOW`: Resets request count at fixed intervals
	 * - `SLIDING_WINDOW`: Smoothly adjusts request count over time
	 * - `TOKEN_BUCKET`: Allows bursts while maintaining average rate
	 */
	algorithm?: Algorithm;
	/**
	 * Time window duration in milliseconds for fixed or sliding window algorithms.
	 * Defines how long the rate limit window lasts.
	 *
	 * @default 60000 (1 minute)
	 *
	 * @example
	 * ```typescript
	 * windowMs: 15 * 60 * 1000 // 15 minutes
	 * ```
	 */
	windowMs?: number;
	/**
	 * Maximum number of requests allowed within the time window (for fixed/sliding window)
	 * or token bucket capacity (for token bucket algorithm).
	 *
	 * @default 60
	 */
	max?: number;

	/**
	 * Token refill rate for token bucket algorithm.
	 * Specifies how many tokens are added per refill interval.
	 *
	 * @default 1
	 * @remarks Only applicable when using TOKEN_BUCKET algorithm
	 */
	refillRate?: number;
	/**
	 * Interval in milliseconds at which tokens are refilled in token bucket algorithm.
	 *
	 * @default 1000 (1 second)
	 * @remarks Only applicable when using TOKEN_BUCKET algorithm
	 */
	refillInterval?: number;

	/**
	 * Time precision in milliseconds for sliding window algorithm.
	 * Lower values provide more accurate rate limiting but use more memory.
	 *
	 * @default 100
	 * @remarks Only applicable when using SLIDING_WINDOW algorithm
	 */
	precision?: number;

	/**
	 * Custom error message returned when rate limit is exceeded.
	 *
	 * @default "Too many requests"
	 *
	 * @example
	 * ```typescript
	 * message: "Rate limit exceeded. Please try again later."
	 * ```
	 */
	message?: string;
	/**
	 * HTTP status code returned when rate limit is exceeded.
	 *
	 * @default 429 (Too Many Requests)
	 */
	statusCode?: number;
	/**
	 * Whether to include rate limit information in response headers.
	 *
	 * Headers included:
	 * - `RateLimit-Limit`: Request limit
	 * - `RateLimit-Remaining`: Remaining requests
	 * - `RateLimit-Reset`: Reset timestamp (seconds)
	 * - `RateLimit-Algorithm`: Algorithm used
	 * - `Retry-After`: Seconds until retry (when limited)
	 *
	 * @default true
	 */
	headers?: boolean;

	/**
	 * Function to generate a unique identifier for rate limiting.
	 * Determines what gets rate limited (e.g., IP, user, API key).
	 *
	 * @param ctx - Request context
	 * @returns Unique identifier string
	 *
	 * @default Uses client IP address
	 *
	 * @example
	 * ```typescript
	 * keyGenerator: (ctx) => {
	 *   // Rate limit by user ID if authenticated, otherwise by IP
	 *   return ctx.get('userId') || ctx.clientIp || 'anonymous';
	 * }
	 * ```
	 */
	keyGenerator?: (ctx: Context<T>) => string;
	/**
	 * Function to generate endpoint identifier for rate limiting.
	 * Allows different rate limits for different endpoints.
	 *
	 * @param ctx - Request context
	 * @returns Endpoint identifier string
	 *
	 * @default Combines HTTP method and pathname
	 *
	 * @example
	 * ```typescript
	 * endpointGenerator: (ctx) => {
	 *   // Group all GET requests together
	 *   return ctx.req.method === 'GET' ? 'GET:*' : `${ctx.req.method}:${ctx.req.url}`;
	 * }
	 * ```
	 */
	endpointGenerator?: (ctx: Context<T>) => string;
	/**
	 * Function to conditionally skip rate limiting for certain requests.
	 * Useful for whitelisting certain IPs, authenticated users, or endpoints.
	 *
	 * @param ctx - Request context
	 * @returns Promise<boolean> or boolean - true to skip rate limiting
	 *
	 * @example
	 * ```typescript
	 * skip: (ctx) => {
	 *   const user = ctx.get('user');
	 *   return user?.role === 'admin' || ctx.clientIp === '127.0.0.1';
	 * }
	 * ```
	 */

	skip?: (ctx: Context<T>) => boolean | Promise<boolean>;

	/**
	 * Interval in milliseconds for cleaning up expired rate limit records.
	 * Lower values free memory faster but use more CPU.
	 *
	 * @default 30000 (30 seconds)
	 */
	cleanupInterval?: number;
	/**
	 * Whether to automatically clean up expired rate limit records.
	 * Disable if managing cleanup externally.
	 *
	 * @default true
	 */
	enableCleanup?: boolean;

	/**
	 * External rate limiter instance to use instead of creating a new one.
	 * Useful for sharing rate limits across multiple middlewares or routes.
	 *
	 * @example
	 * ```typescript
	 * const sharedLimiter = createRateLimiter({ max: 100 });
	 * app.use('/api', rateLimit({ rateLimiter: sharedLimiter }));
	 * app.use('/auth', rateLimit({ rateLimiter: sharedLimiter }));
	 * ```
	 */
	rateLimiter?: RateLimiter;
}

/**
 * Creates a rate limiting middleware for web applications.
 *
 * This middleware uses the @rabbit-company/rate-limiter library to implement
 * various rate limiting algorithms including fixed window, sliding window,
 * and token bucket.
 *
 * @template T - Type of the context state object
 * @param options - Rate limiting configuration options
 * @returns Middleware function for rate limiting
 *
 * @example
 * Basic usage with defaults (60 requests per minute):
 * ```typescript
 * app.use(rateLimit());
 * ```
 *
 * @example
 * Custom configuration with fixed window:
 * ```typescript
 * app.use(rateLimit({
 *   windowMs: 15 * 60 * 1000, // 15 minutes
 *   max: 100, // 100 requests per 15 minutes
 *   message: "Too many requests from this IP",
 *   headers: true
 * }));
 * ```
 *
 * @example
 * Sliding window for smoother rate limiting:
 * ```typescript
 * app.use(rateLimit({
 *   algorithm: Algorithm.SLIDING_WINDOW,
 *   windowMs: 60 * 1000, // 1 minute
 *   max: 60, // 60 requests per minute
 *   precision: 100 // 100ms precision
 * }));
 * ```
 *
 * @example
 * Token bucket for handling bursts:
 * ```typescript
 * app.use(rateLimit({
 *   algorithm: Algorithm.TOKEN_BUCKET,
 *   max: 10, // bucket capacity of 10 tokens
 *   refillRate: 2, // add 2 tokens per interval
 *   refillInterval: 1000 // refill every second
 * }));
 * ```
 *
 * @example
 * Route-specific rate limiting:
 * ```typescript
 * // Strict limit for login endpoint
 * app.post('/api/login', rateLimit({
 *   windowMs: 15 * 60 * 1000, // 15 minutes
 *   max: 5, // only 5 login attempts per 15 minutes
 *   message: "Too many login attempts. Please try again later."
 * }));
 *
 * // More relaxed limit for API endpoints
 * app.use('/api', rateLimit({
 *   windowMs: 60 * 1000,
 *   max: 100
 * }));
 * ```
 *
 * @example
 * Advanced key generation:
 * ```typescript
 * app.use('/api', rateLimit({
 *   keyGenerator: (ctx) => {
 *     // Rate limit by API key if present, user ID if authenticated, otherwise by IP
 *     const apiKey = ctx.req.headers.get('X-API-Key');
 *     if (apiKey) return `api:${apiKey}`;
 *
 *     const userId = ctx.get('userId');
 *     if (userId) return `user:${userId}`;
 *
 *     return ctx.clientIp || 'anonymous';
 *   },
 *   endpointGenerator: (ctx) => {
 *     // Group endpoints by resource
 *     const url = new URL(ctx.req.url);
 *     const resource = url.pathname.split('/')[2]; // e.g., /api/users -> users
 *     return `${ctx.req.method}:${resource || 'root'}`;
 *   }
 * }));
 * ```
 *
 * @example
 * Conditional rate limiting:
 * ```typescript
 * app.use(rateLimit({
 *   skip: async (ctx) => {
 *     // Skip rate limiting for:
 *     // 1. Authenticated admins
 *     const user = ctx.get('user');
 *     if (user?.role === 'admin') return true;
 *
 *     // 2. Whitelisted IPs
 *     const whitelist = ['192.168.1.1', '10.0.0.1'];
 *     if (whitelist.includes(ctx.clientIp)) return true;
 *
 *     // 3. Health check endpoints
 *     if (ctx.req.url.includes('/health')) return true;
 *
 *     return false;
 *   }
 * }));
 * ```
 *
 * @see {@link createRateLimiter} for creating shared rate limiter instances
 * @see {@link createKeyGenerator} for advanced key generation utilities
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
 * Default key generator that extracts client IP address for rate limiting.
 *
 * @template T - Context state type
 * @param ctx - The request context
 * @returns Client IP address or "unknown" if not available
 *
 * @internal
 */
function defaultKeyGenerator<T extends Record<string, unknown>>(ctx: Context<T>): string {
	return ctx.clientIp || "unknown";
}

/**
 * Default endpoint generator that creates a unique identifier by combining
 * HTTP method and URL pathname.
 *
 * @template T - Context state type
 * @param ctx - The request context
 * @returns Endpoint identifier in format "METHOD:pathname"
 *
 * @example
 * ```typescript
 * // GET /api/users -> "GET:/api/users"
 * // POST /api/users/123 -> "POST:/api/users/123"
 * ```
 *
 * @internal
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
 * Creates a shared rate limiter instance that can be used across multiple
 * middleware instances or routes. This is useful for implementing global
 * rate limits or sharing limits between related endpoints.
 *
 * @param config - Rate limiter configuration
 * @returns Configured RateLimiter instance
 *
 * @example
 * Basic shared limiter:
 * ```typescript
 * const apiLimiter = createRateLimiter({
 *   algorithm: Algorithm.SLIDING_WINDOW,
 *   windowMs: 60 * 1000,
 *   max: 100
 * });
 *
 * // Apply same limits to multiple routes
 * app.use('/api/users', rateLimit({ rateLimiter: apiLimiter }));
 * app.use('/api/posts', rateLimit({ rateLimiter: apiLimiter }));
 * app.use('/api/comments', rateLimit({ rateLimiter: apiLimiter }));
 * ```
 *
 * @example
 * Multiple shared limiters for different tiers:
 * ```typescript
 * // Strict limiter for authentication endpoints
 * const authLimiter = createRateLimiter({
 *   algorithm: Algorithm.FIXED_WINDOW,
 *   windowMs: 15 * 60 * 1000, // 15 minutes
 *   max: 5 // 5 attempts per 15 minutes
 * });
 *
 * // Standard limiter for API endpoints
 * const apiLimiter = createRateLimiter({
 *   algorithm: Algorithm.SLIDING_WINDOW,
 *   windowMs: 60 * 1000, // 1 minute
 *   max: 60 // 60 requests per minute
 * });
 *
 * // Relaxed limiter for static assets
 * const assetLimiter = createRateLimiter({
 *   algorithm: Algorithm.TOKEN_BUCKET,
 *   max: 100, // bucket capacity
 *   refillRate: 10, // 10 tokens per second
 *   refillInterval: 1000
 * });
 *
 * app.post('/auth/login', rateLimit({ rateLimiter: authLimiter }));
 * app.use('/api', rateLimit({ rateLimiter: apiLimiter }));
 * app.use('/assets', rateLimit({ rateLimiter: assetLimiter }));
 * ```
 *
 * @example
 * Monitoring limiter statistics:
 * ```typescript
 * const limiter = createRateLimiter({ max: 100 });
 *
 * // Periodically log statistics
 * setInterval(() => {
 *   console.log(`Active rate limits: ${limiter.getSize()}`);
 *   // Additional monitoring logic
 * }, 60000);
 * ```
 *
 * @see {@link RateLimiter} for available methods and properties
 */
export function createRateLimiter(config?: Partial<RateLimitConfig>): RateLimiter {
	return new RateLimiter(config);
}

/**
 * Configuration options for the key generator utility.
 *
 * @interface KeyGeneratorOptions
 * @template T - Context state type
 */
interface KeyGeneratorOptions<T extends Record<string, unknown>> {
	/**
	 * Custom function to generate the rate limit key.
	 * If not provided, defaults to using the client IP address.
	 *
	 * @param ctx - Request context
	 * @returns Rate limit key or null/undefined (will fallback to "unknown")
	 */
	custom?: (ctx: Context<T>) => string | null;
}

/**
 * Creates a custom key generator function for flexible rate limiting strategies.
 * By default, uses the client IP address. Provide a custom function to use any request attribute.
 *
 * @template T - Context state type
 * @param options - Key generator configuration
 * @returns Function that generates keys for rate limiting
 *
 * @example
 * Default behavior (IP-based):
 * ```typescript
 * const keyGen = createKeyGenerator({});
 * // Uses client IP address
 * ```
 *
 * @example
 * User-based rate limiting:
 * ```typescript
 * const userKeyGen = createKeyGenerator({
 *   custom: (ctx) => {
 *     const userId = ctx.get('userId');
 *     return userId ? `user:${userId}` : ctx.clientIp;
 *   }
 * });
 * ```
 *
 * @example
 * API key based rate limiting:
 * ```typescript
 * const apiKeyGen = createKeyGenerator({
 *   custom: (ctx) => {
 *     const apiKey = ctx.req.headers.get('X-API-Key');
 *     return apiKey ? `api:${apiKey}` : null;
 *   }
 * });
 * ```
 *
 * @example
 * Combined IP + User rate limiting:
 * ```typescript
 * const comboKeyGen = createKeyGenerator({
 *   custom: (ctx) => {
 *     const userId = ctx.get('userId');
 *     const ip = ctx.clientIp || 'unknown-ip';
 *     return userId ? `${ip}:user:${userId}` : ip;
 *   }
 * });
 * ```
 *
 * @example
 * Session-based rate limiting:
 * ```typescript
 * const sessionKeyGen = createKeyGenerator({
 *   custom: (ctx) => {
 *     const sessionId = ctx.get('sessionId') || ctx.req.headers.get('X-Session-ID');
 *     return sessionId ? `session:${sessionId}` : ctx.clientIp;
 *   }
 * });
 * ```
 *
 * @example
 * Tiered rate limiting by subscription:
 * ```typescript
 * const tieredKeyGen = createKeyGenerator({
 *   custom: (ctx) => {
 *     const user = ctx.get('user');
 *     if (!user) return ctx.clientIp || 'anonymous';
 *
 *     // Create different rate limit buckets per tier
 *     const tier = user.subscription || 'basic';
 *     return `tier:${tier}:user:${user.id}`;
 *   }
 * });
 * ```
 *
 * @example
 * Geographic rate limiting:
 * ```typescript
 * const geoKeyGen = createKeyGenerator({
 *   custom: (ctx) => {
 *     const country = ctx.get('geoCountry');
 *     const region = ctx.get('geoRegion');
 *
 *     if (country && region) {
 *       return `geo:${country}:${region}`;
 *     } else if (country) {
 *       return `geo:${country}`;
 *     }
 *     return ctx.clientIp;
 *   }
 * });
 * ```
 */
export function createKeyGenerator<T extends Record<string, unknown>>(options: KeyGeneratorOptions<T>): (ctx: Context<T>) => string {
	const { custom } = options;

	return (ctx: Context<T>): string => {
		if (custom) return custom(ctx) || "unknown";
		return ctx.clientIp || "unknown";
	};
}

export * from "@rabbit-company/rate-limiter";
export type * from "@rabbit-company/rate-limiter";
