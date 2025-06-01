import type { Context, Middleware } from "../../../core/src";
import { createHash } from "crypto";

/**
 * Cache storage interface that all cache backends must implement
 */
export interface CacheStorage {
	get(key: string): Promise<CacheEntry | null>;
	set(key: string, entry: CacheEntry, ttl?: number, maxStaleAge?: number): Promise<void>;
	delete(key: string): Promise<boolean>;
	clear(): Promise<void>;
	has(key: string): Promise<boolean>;
	size(): Promise<number>;
}

/**
 * Cached response data structure
 */
export interface CacheEntry {
	status: number;
	headers: Record<string, string>;
	body: string;
	timestamp: number;
	etag?: string;
}

/**
 * Cache middleware configuration options
 */
export interface CacheConfig {
	/**
	 * Cache storage backend
	 * @default new MemoryCache()
	 */
	storage?: CacheStorage;

	/**
	 * Default TTL in seconds
	 * @default 300 (5 minutes)
	 */
	ttl?: number;

	/**
	 * Methods to cache
	 * @default ['GET', 'HEAD']
	 */
	methods?: string[];

	/**
	 * Function to generate cache key from request
	 */
	keyGenerator?: (ctx: Context<any>) => string;

	/**
	 * Function to determine if response should be cached
	 */
	shouldCache?: (ctx: Context<any>, res: Response) => boolean;

	/**
	 * Headers to vary cache by
	 * @default ['accept', 'accept-encoding']
	 */
	varyHeaders?: string[];

	/**
	 * Whether to respect Cache-Control headers
	 * @default true
	 */
	respectCacheControl?: boolean;

	/**
	 * Whether to add cache status header
	 * @default true
	 */
	addCacheHeader?: boolean;

	/**
	 * Cache status header name
	 * @default 'x-cache-status'
	 */
	cacheHeaderName?: string;

	/**
	 * Whether to cache private responses
	 * @default false
	 */
	cachePrivate?: boolean;

	/**
	 * Paths to exclude from caching
	 * @default []
	 */
	excludePaths?: (string | RegExp)[];

	/**
	 * Paths to include for caching (if set, only these paths are cached)
	 */
	includePaths?: (string | RegExp)[];

	/**
	 * Whether to serve stale content while revalidating
	 * @default false
	 */
	staleWhileRevalidate?: boolean;

	/**
	 * Maximum stale age in seconds
	 * @default 86400 (24 hours)
	 */
	maxStaleAge?: number;
}

/**
 * In-memory cache implementation
 */
export class MemoryCache implements CacheStorage {
	private cache = new Map<string, { entry: CacheEntry; expiry?: number; deleteAt?: number }>();
	private timers = new Map<string, NodeJS.Timeout>();

	async get(key: string): Promise<CacheEntry | null> {
		const item = this.cache.get(key);
		if (!item) return null;

		// Check hard delete time
		if (item.deleteAt && Date.now() > item.deleteAt) {
			await this.delete(key);
			return null;
		}

		// For stale-while-revalidate, we return entries even if past expiry
		// The middleware will handle checking if it's stale
		return item.entry;
	}

	async set(key: string, entry: CacheEntry, ttl?: number, maxStaleAge?: number): Promise<void> {
		// Clear existing timer
		const existingTimer = this.timers.get(key);
		if (existingTimer) {
			clearTimeout(existingTimer);
			this.timers.delete(key);
		}

		const expiry = ttl ? Date.now() + ttl * 1000 : undefined;
		// For stale-while-revalidate, keep entry longer than TTL
		const deleteAt = ttl && maxStaleAge ? Date.now() + (ttl + maxStaleAge) * 1000 : expiry;

		this.cache.set(key, { entry, expiry, deleteAt });

		// Set cleanup timer for the delete time
		if (deleteAt) {
			const deleteIn = deleteAt - Date.now();
			const timer = setTimeout(() => {
				this.delete(key);
			}, deleteIn);
			this.timers.set(key, timer);
		}
	}

	async delete(key: string): Promise<boolean> {
		const timer = this.timers.get(key);
		if (timer) {
			clearTimeout(timer);
			this.timers.delete(key);
		}
		return this.cache.delete(key);
	}

	async clear(): Promise<void> {
		// Clear all timers
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		this.timers.clear();
		this.cache.clear();
	}

	async has(key: string): Promise<boolean> {
		const item = this.cache.get(key);
		if (!item) return false;

		// Check hard delete time
		if (item.deleteAt && Date.now() > item.deleteAt) {
			await this.delete(key);
			return false;
		}

		return true;
	}

	async size(): Promise<number> {
		// Clean up expired entries first
		const now = Date.now();
		for (const [key, item] of this.cache.entries()) {
			if (item.deleteAt && now > item.deleteAt) {
				await this.delete(key);
			}
		}
		return this.cache.size;
	}
}

/**
 * LRU (Least Recently Used) cache implementation
 */
export class LRUCache implements CacheStorage {
	private cache = new Map<string, { entry: CacheEntry; expiry?: number }>();
	private maxSize: number;

	constructor(maxSize = 1000) {
		this.maxSize = maxSize;
	}

	async get(key: string): Promise<CacheEntry | null> {
		const item = this.cache.get(key);
		if (!item) return null;

		// Check expiry
		if (item.expiry && Date.now() > item.expiry) {
			await this.delete(key);
			return null;
		}

		// Move to end (most recently used)
		this.cache.delete(key);
		this.cache.set(key, item);

		return item.entry;
	}

	async set(key: string, entry: CacheEntry, ttl?: number, maxStaleAge?: number): Promise<void> {
		// Delete if exists to update position
		this.cache.delete(key);

		// Check size limit
		if (this.cache.size >= this.maxSize) {
			// Remove least recently used (first item)
			const firstKey = this.cache.keys().next().value;
			if (firstKey !== undefined) {
				this.cache.delete(firstKey);
			}
		}

		const expiry = ttl ? Date.now() + ttl * 1000 : undefined;
		this.cache.set(key, { entry, expiry });
	}

	async delete(key: string): Promise<boolean> {
		return this.cache.delete(key);
	}

	async clear(): Promise<void> {
		this.cache.clear();
	}

	async has(key: string): Promise<boolean> {
		const item = this.cache.get(key);
		if (!item) return false;

		// Check expiry
		if (item.expiry && Date.now() > item.expiry) {
			await this.delete(key);
			return false;
		}

		return true;
	}

	async size(): Promise<number> {
		return this.cache.size;
	}
}

/**
 * Parse Cache-Control header
 */
function parseCacheControl(header: string | null): Record<string, string | boolean> {
	if (!header) return {};

	const directives: Record<string, string | boolean> = {};
	const parts = header.split(",").map((p) => p.trim());

	for (const part of parts) {
		const [key, value] = part.split("=").map((s) => s.trim());
		directives[key.toLowerCase()] = value || true;
	}

	return directives;
}

/**
 * Calculate TTL from Cache-Control header
 */
function getTTLFromCacheControl(cacheControl: Record<string, string | boolean>): number | null {
	if (cacheControl["no-store"] || cacheControl["no-cache"]) {
		return 0;
	}

	if (cacheControl["s-maxage"]) {
		const sMaxAge = parseInt(cacheControl["s-maxage"] as string, 10);
		if (!isNaN(sMaxAge)) {
			return sMaxAge;
		}
	}

	if (cacheControl["max-age"]) {
		const maxAge = parseInt(cacheControl["max-age"] as string, 10);
		if (!isNaN(maxAge)) {
			return maxAge;
		}
	}

	return null;
}

/**
 * Generate ETag from response body
 */
async function generateETag(body: string): Promise<string> {
	return createHash("blake2b512").update(body).digest("hex");
}

/**
 * Check if path matches any pattern in the list
 */
function matchesPath(path: string, patterns: (string | RegExp)[]): boolean {
	return patterns.some((pattern) => {
		if (typeof pattern === "string") {
			return path === pattern || path.startsWith(pattern);
		}
		return pattern.test(path);
	});
}

/**
 * Cache middleware factory
 *
 * @example
 * ```typescript
 * // Basic usage
 * app.use(cache());
 *
 * // With custom configuration
 * app.use(cache({
 *   ttl: 600, // 10 minutes
 *   storage: new LRUCache(500),
 *   excludePaths: ['/api/auth', /^\/admin/]
 * }));
 * ```
 */
export function cache<T extends Record<string, unknown> = Record<string, unknown>>(config: CacheConfig = {}): Middleware<T> {
	// Apply defaults
	const options = {
		storage: new MemoryCache(),
		ttl: 300,
		methods: ["GET", "HEAD"],
		keyGenerator: (ctx: Context<any>) => `${ctx.req.method}:${ctx.req.url}`,
		shouldCache: (ctx: Context<any>, res: Response) => res.status >= 200 && res.status < 300,
		varyHeaders: ["accept", "accept-encoding"],
		respectCacheControl: true,
		addCacheHeader: true,
		cacheHeaderName: "x-cache-status",
		cachePrivate: false,
		excludePaths: [] as (string | RegExp)[],
		includePaths: undefined as (string | RegExp)[] | undefined,
		staleWhileRevalidate: false,
		maxStaleAge: 86400,
		...config,
	};

	// Background revalidation tracker
	const revalidating = new Set<string>();

	// Store response in cache
	async function storeCachedResponse(key: string, response: Response, cacheControl?: Record<string, string | boolean>) {
		// Check if response is cacheable
		if (options.respectCacheControl) {
			const cc = cacheControl || parseCacheControl(response.headers.get("cache-control"));
			if (cc["no-store"]) {
				return;
			}
			if (cc["private"] && !options.cachePrivate) {
				return;
			}
		}

		// Clone response to read body
		const cloned = response.clone();
		const body = await cloned.text();

		// Generate ETag if not present
		let etag = response.headers.get("etag");
		if (!etag) {
			etag = await generateETag(body);
		}

		// Extract headers
		const headers: Record<string, string> = {};
		response.headers.forEach((value, key) => {
			// Skip headers that shouldn't be cached
			if (!["set-cookie", "age", options.cacheHeaderName.toLowerCase()].includes(key.toLowerCase())) {
				headers[key] = value;
			}
		});

		// Create cache entry
		const entry: CacheEntry = {
			status: response.status,
			headers,
			body,
			timestamp: Date.now(),
			etag,
		};

		// Calculate TTL
		let ttl = options.ttl;
		if (options.respectCacheControl) {
			const cc = cacheControl || parseCacheControl(response.headers.get("cache-control"));
			const ccTTL = getTTLFromCacheControl(cc);
			if (ccTTL !== null) {
				ttl = ccTTL;
			}
		}

		// Store in cache with error handling
		if (ttl > 0) {
			try {
				await options.storage.set(key, entry, ttl, options.maxStaleAge);
			} catch (error) {
				// Ignore storage errors
			}
		}
	}

	return async (ctx: Context<T>, next) => {
		// Check if method is cacheable
		if (!options.methods.includes(ctx.req.method)) {
			return next();
		}

		// Check path filters
		const url = new URL(ctx.req.url);
		const path = url.pathname;

		if (options.excludePaths.length > 0 && matchesPath(path, options.excludePaths)) {
			return next();
		}

		if (options.includePaths && !matchesPath(path, options.includePaths)) {
			return next();
		}

		// Check if this is a background revalidation request
		const isBypass = ctx.req.headers.get("x-cache-bypass") === "revalidation";
		if (isBypass) {
			return next();
		}

		// Generate cache key
		let cacheKey = options.keyGenerator(ctx);

		// Add vary headers to key
		if (options.varyHeaders.length > 0) {
			const varyParts: string[] = [];
			for (const header of options.varyHeaders) {
				const value = ctx.req.headers.get(header);
				if (value) {
					varyParts.push(`${header}:${value}`);
				}
			}
			if (varyParts.length > 0) {
				cacheKey += `?vary=${varyParts.join(",")}`;
			}
		}

		// Check cache with error handling
		let cached: CacheEntry | null = null;
		try {
			cached = await options.storage.get(cacheKey);
		} catch (error) {
			// Log error but continue without cache
			console.error("Cache storage get error:", error);
		}

		// Handle conditional requests
		if (cached && ctx.req.headers.get("if-none-match") === cached.etag) {
			const age = Math.floor((Date.now() - cached.timestamp) / 1000);
			const headers = new Headers(cached.headers);

			// Add age header
			headers.set("age", age.toString());

			// Add cache status header
			if (options.addCacheHeader) {
				headers.set(options.cacheHeaderName, "HIT");
			}

			// Ensure ETag is set
			if (cached.etag) {
				headers.set("etag", cached.etag);
			}

			return new Response(null, {
				status: 304,
				headers,
			});
		}

		// Serve from cache if available
		if (cached) {
			const age = Math.floor((Date.now() - cached.timestamp) / 1000);
			const headers = new Headers(cached.headers);

			// Check if still fresh
			let ttl = options.ttl;
			if (options.respectCacheControl) {
				const cacheControl = parseCacheControl(headers.get("cache-control"));
				const ccTTL = getTTLFromCacheControl(cacheControl);
				if (ccTTL !== null) {
					ttl = ccTTL;
				}
			}

			const isFresh = age < ttl;
			const isStale = !isFresh && options.staleWhileRevalidate && age < ttl + (options.maxStaleAge || 0);

			if (isFresh || isStale) {
				// Add cache headers
				headers.set("age", age.toString());
				if (options.addCacheHeader) {
					headers.set(options.cacheHeaderName, isFresh ? "HIT" : "STALE");
				}

				// For stale content, setup background revalidation
				if (isStale && !revalidating.has(cacheKey)) {
					revalidating.add(cacheKey);

					// Use the most appropriate async scheduling method
					const scheduleRevalidation = () => {
						(async () => {
							try {
								const revalidateHeaders = new Headers(ctx.req.headers);
								revalidateHeaders.set("x-cache-bypass", "revalidation");

								const url = new URL(ctx.req.url);
								const bgResponse = await fetch(url.toString(), {
									method: ctx.req.method,
									headers: revalidateHeaders,
								});

								if (bgResponse.ok && options.shouldCache(ctx, bgResponse)) {
									await storeCachedResponse(cacheKey, bgResponse.clone());
								}
							} catch {
							} finally {
								revalidating.delete(cacheKey);
							}
						})();
					};

					setImmediate(scheduleRevalidation);
				}

				// Return the stale response immediately
				const response = new Response(cached.body, {
					status: cached.status,
					headers,
				});

				return response;
			}
		}

		const response = await next();

		// Process response for caching and ETag
		if (response instanceof Response) {
			// Add cache status header for miss
			if (options.addCacheHeader) {
				response.headers.set(options.cacheHeaderName, "MISS");
			}

			// Generate and set ETag if not present
			if (options.shouldCache(ctx, response) && !response.headers.get("etag")) {
				// Clone response to read body for ETag generation
				const cloned = response.clone();
				const body = await cloned.text();
				const etag = await generateETag(body);

				// Create new response with ETag header
				const headers = new Headers(response.headers);
				headers.set("etag", etag);

				// Store in background (don't block response)
				const responseWithEtag = new Response(body, {
					status: response.status,
					statusText: response.statusText,
					headers,
				});

				// Cache the response with ETag
				storeCachedResponse(cacheKey, responseWithEtag).catch(() => {
					// Ignore storage errors
				});

				return responseWithEtag;
			}

			// Cache the original response if it already has an ETag
			if (options.shouldCache(ctx, response)) {
				storeCachedResponse(cacheKey, response.clone()).catch(() => {
					// Ignore storage errors
				});
			}
		}

		return response;
	};
}

/**
 * Redis cache implementation
 * Requires a Redis client that supports the following methods:
 * - get(key): Promise<string | null>
 * - set(key, value): Promise<"OK">
 * - setex(key, seconds, value): Promise<"OK">
 * - del(...keys): Promise<number>
 * - exists(key): Promise<number>
 * - keys(pattern): Promise<string[]>
 * - scan(cursor, options): Promise<[string, string[]]>
 */
export class RedisCache implements CacheStorage {
	private client: any;
	private keyPrefix: string;
	private scanCount: number;

	constructor(client: any, keyPrefix = "cache:", scanCount = 100) {
		this.client = client;
		this.keyPrefix = keyPrefix;
		this.scanCount = scanCount;
	}

	private getKey(key: string): string {
		return `${this.keyPrefix}${key}`;
	}

	async get(key: string): Promise<CacheEntry | null> {
		try {
			const data = await this.client.get(this.getKey(key));
			if (!data) return null;

			const entry = JSON.parse(data) as CacheEntry;
			return entry;
		} catch (error) {
			// Handle JSON parse errors or Redis errors
			return null;
		}
	}

	async set(key: string, entry: CacheEntry, ttl?: number, maxStaleAge?: number): Promise<void> {
		const data = JSON.stringify(entry);
		const redisKey = this.getKey(key);

		try {
			// For Redis, we use the total TTL (fresh + stale)
			const totalTtl = ttl && maxStaleAge ? ttl + maxStaleAge : ttl;
			if (totalTtl && totalTtl > 0) {
				await this.client.setex(redisKey, totalTtl, data);
			} else {
				await this.client.set(redisKey, data);
			}
		} catch (error) {
			// Log error but don't throw - caching should not break the app
			console.error("Redis cache set error:", error);
		}
	}

	async delete(key: string): Promise<boolean> {
		try {
			const result = await this.client.del(this.getKey(key));
			return result > 0;
		} catch (error) {
			return false;
		}
	}

	async clear(): Promise<void> {
		try {
			// Use SCAN to avoid blocking Redis with KEYS command
			let cursor = "0";
			const pattern = `${this.keyPrefix}*`;

			do {
				const [nextCursor, keys] = await this.client.scan(cursor, "MATCH", pattern, "COUNT", this.scanCount);

				if (keys.length > 0) {
					await this.client.del(...keys);
				}

				cursor = nextCursor;
			} while (cursor !== "0");
		} catch (error) {
			console.error("Redis cache clear error:", error);
		}
	}

	async has(key: string): Promise<boolean> {
		try {
			const exists = await this.client.exists(this.getKey(key));
			return exists > 0;
		} catch (error) {
			return false;
		}
	}

	async size(): Promise<number> {
		try {
			// Use SCAN to count keys without blocking
			let cursor = "0";
			let count = 0;
			const pattern = `${this.keyPrefix}*`;

			do {
				const [nextCursor, keys] = await this.client.scan(cursor, "MATCH", pattern, "COUNT", this.scanCount);

				count += keys.length;
				cursor = nextCursor;
			} while (cursor !== "0");

			return count;
		} catch (error) {
			return 0;
		}
	}

	/**
	 * Delete multiple keys by pattern (Redis-specific feature)
	 * Useful for cache invalidation
	 */
	async deletePattern(pattern: string): Promise<number> {
		try {
			let cursor = "0";
			let deletedCount = 0;
			const searchPattern = `${this.keyPrefix}${pattern}`;

			do {
				const [nextCursor, keys] = await this.client.scan(cursor, "MATCH", searchPattern, "COUNT", this.scanCount);

				if (keys.length > 0) {
					deletedCount += await this.client.del(...keys);
				}

				cursor = nextCursor;
			} while (cursor !== "0");

			return deletedCount;
		} catch (error) {
			console.error("Redis deletePattern error:", error);
			return 0;
		}
	}
}

/**
 * Create a Redis cache instance with common Redis clients
 *
 * @example
 * ```typescript
 * // With ioredis
 * import Redis from 'ioredis';
 * const redis = new Redis();
 * const cache = createRedisCache(redis);
 *
 * // With node-redis
 * import { createClient } from 'redis';
 * const client = createClient();
 * await client.connect();
 * const cache = createRedisCache(client);
 *
 * // Use in middleware
 * app.use(cache({ storage: cache }));
 * ```
 */
export function createRedisCache(
	client: any,
	options?: {
		keyPrefix?: string;
		scanCount?: number;
	}
): RedisCache {
	return new RedisCache(client, options?.keyPrefix, options?.scanCount);
}

/**
 * Cache invalidation utilities
 */
export const cacheUtils = {
	/**
	 * Create a cache invalidation middleware
	 *
	 * @example
	 * ```typescript
	 * // Invalidate specific keys
	 * app.post('/posts',
	 *   createPost,
	 *   cacheUtils.invalidate({
	 *     storage: redisCache,
	 *     keys: ['GET:/posts', 'GET:/posts/latest']
	 *   })
	 * );
	 *
	 * // Invalidate by patterns (Redis only)
	 * app.put('/posts/:id',
	 *   updatePost,
	 *   cacheUtils.invalidate({
	 *     storage: redisCache,
	 *     patterns: ['GET:/posts', 'GET:/posts/*']
	 *   })
	 * );
	 * ```
	 */
	invalidate<T extends Record<string, unknown> = Record<string, unknown>>(options: {
		storage: CacheStorage;
		patterns?: (string | RegExp)[];
		keys?: string[];
	}): Middleware<T> {
		return async (ctx, next) => {
			const response = await next();

			// Only invalidate on successful mutations
			if (response instanceof Response && response.status >= 200 && response.status < 300) {
				// Invalidate specific keys
				if (options.keys) {
					await Promise.all(options.keys.map((key) => options.storage.delete(key)));
				}

				// Pattern-based invalidation for Redis
				if (options.patterns && "deletePattern" in options.storage) {
					const redisStorage = options.storage as RedisCache;
					await Promise.all(
						options.patterns.map(async (pattern) => {
							if (typeof pattern === "string") {
								// Convert glob patterns to Redis patterns
								const redisPattern = pattern.replace(/\*/g, "*").replace(/\?/g, "?");
								await redisStorage.deletePattern(redisPattern);
							}
							// RegExp patterns not supported by Redis SCAN
						})
					);
				}
			}

			return response;
		};
	},

	/**
	 * Clear entire cache
	 */
	clear(storage: CacheStorage): Promise<void> {
		return storage.clear();
	},

	/**
	 * Get cache statistics
	 */
	async stats(storage: CacheStorage): Promise<{ size: number }> {
		return {
			size: await storage.size(),
		};
	},
};
