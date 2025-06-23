import type { Context, Middleware } from "@rabbit-company/web";
import { createHash, getHashes } from "node:crypto";

/**
 * Cache storage interface that all cache backends must implement.
 * Provides a consistent API for different storage mechanisms (memory, Redis, etc.)
 *
 * @interface CacheStorage
 */
export interface CacheStorage {
	/**
	 * Retrieve a cache entry by key
	 * @param {string} key - The cache key
	 * @returns {Promise<CacheEntry | null>} The cache entry or null if not found
	 */
	get(key: string): Promise<CacheEntry | null>;

	/**
	 * Store a cache entry
	 * @param {string} key - The cache key
	 * @param {CacheEntry} entry - The cache entry to store
	 * @param {number} [ttl] - Time to live in seconds
	 * @param {number} [maxStaleAge] - Maximum stale age in seconds for stale-while-revalidate
	 * @returns {Promise<void>}
	 */
	set(key: string, entry: CacheEntry, ttl?: number, maxStaleAge?: number): Promise<void>;

	/**
	 * Delete a cache entry
	 * @param {string} key - The cache key
	 * @returns {Promise<boolean>} True if the entry was deleted, false otherwise
	 */
	delete(key: string): Promise<boolean>;

	/**
	 * Clear all cache entries
	 * @returns {Promise<void>}
	 */
	clear(): Promise<void>;

	/**
	 * Check if a cache entry exists
	 * @param {string} key - The cache key
	 * @returns {Promise<boolean>} True if the entry exists, false otherwise
	 */
	has(key: string): Promise<boolean>;

	/**
	 * Get the number of entries in the cache
	 * @returns {Promise<number>} The number of cache entries
	 */
	size(): Promise<number>;
}

/**
 * Cached response data structure
 *
 * @interface CacheEntry
 */
export interface CacheEntry {
	/** HTTP status code */
	status: number;
	/** Response headers */
	headers: Record<string, string>;
	/** Response body as string */
	body: string;
	/** Timestamp when the entry was cached */
	timestamp: number;
	/** ETag value for conditional requests */
	etag?: string;
}

/**
 * Function signature for generating cache keys
 * @callback KeyGenerator
 * @param {Context<any>} ctx - The request context
 * @returns {string} The generated cache key
 */
type KeyGenerator = (ctx: Context<any>) => string;

/**
 * Function signature for determining if a response should be cached
 * @callback ShouldCacheFunction
 * @param {Context<any>} ctx - The request context
 * @param {Response} res - The response
 * @returns {boolean} True if the response should be cached
 */
type ShouldCacheFunction = (ctx: Context<any>, res: Response) => boolean;

/**
 * Cache middleware configuration options
 *
 * @interface CacheConfig
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
	 * HTTP methods to cache
	 * @default ['GET', 'HEAD']
	 */
	methods?: string[];

	/**
	 * Function to generate cache key from request
	 * @default (ctx) => `${ctx.req.method}:${ctx.req.url}`
	 */
	keyGenerator?: KeyGenerator;

	/**
	 * Function to determine if response should be cached
	 * @default (ctx, res) => res.status >= 200 && res.status < 300
	 */
	shouldCache?: ShouldCacheFunction;

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
	 * @default undefined
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

	/**
	 * Hash algorithm to use for ETag generation
	 * @default 'blake2b512'
	 * @see getAvailableHashAlgorithms() for available algorithms
	 */
	hashAlgorithm?: string;
}

/**
 * Storage item with expiry information
 * @internal
 */
interface MemoryCacheItem {
	/** The cached entry */
	entry: CacheEntry;
	/** Expiry timestamp for fresh content */
	expiry?: number;
	/** Delete timestamp for stale content */
	deleteAt?: number;
}

/**
 * In-memory cache implementation with automatic expiry
 *
 * @class MemoryCache
 * @implements {CacheStorage}
 * @example
 * ```typescript
 * const cache = new MemoryCache();
 * await cache.set("key", entry, 300); // Cache for 5 minutes
 * const cached = await cache.get("key");
 * ```
 */
export class MemoryCache implements CacheStorage {
	/** Internal storage map */
	private cache = new Map<string, MemoryCacheItem>();
	/** Cleanup timers map */
	private timers = new Map<string, NodeJS.Timeout>();

	/**
	 * Retrieve a cache entry
	 * @param {string} key - The cache key
	 * @returns {Promise<CacheEntry | null>} The cache entry or null
	 */
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

	/**
	 * Store a cache entry with automatic expiry
	 * @param {string} key - The cache key
	 * @param {CacheEntry} entry - The cache entry
	 * @param {number} [ttl] - Time to live in seconds
	 * @param {number} [maxStaleAge] - Maximum stale age in seconds
	 * @returns {Promise<void>}
	 */
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

	/**
	 * Delete a cache entry
	 * @param {string} key - The cache key
	 * @returns {Promise<boolean>} True if deleted
	 */
	async delete(key: string): Promise<boolean> {
		const timer = this.timers.get(key);
		if (timer) {
			clearTimeout(timer);
			this.timers.delete(key);
		}
		return this.cache.delete(key);
	}

	/**
	 * Clear all cache entries and timers
	 * @returns {Promise<void>}
	 */
	async clear(): Promise<void> {
		// Clear all timers
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		this.timers.clear();
		this.cache.clear();
	}

	/**
	 * Check if a cache entry exists
	 * @param {string} key - The cache key
	 * @returns {Promise<boolean>} True if exists
	 */
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

	/**
	 * Get the number of entries in the cache
	 * @returns {Promise<number>} The size
	 */
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
 * LRU cache item with expiry
 * @internal
 */
interface LRUCacheItem {
	/** The cached entry */
	entry: CacheEntry;
	/** Expiry timestamp */
	expiry?: number;
}

/**
 * LRU (Least Recently Used) cache implementation
 *
 * @class LRUCache
 * @implements {CacheStorage}
 * @example
 * ```typescript
 * const cache = new LRUCache(1000); // Max 1000 entries
 * await cache.set("key", entry);
 * ```
 */
export class LRUCache implements CacheStorage {
	/** Internal storage map */
	private cache = new Map<string, LRUCacheItem>();
	/** Maximum number of entries */
	private maxSize: number;

	/**
	 * Create a new LRU cache
	 * @param {number} [maxSize=1000] - Maximum number of entries
	 */
	constructor(maxSize = 1000) {
		this.maxSize = maxSize;
	}

	/**
	 * Get a cache entry and update its position
	 * @param {string} key - The cache key
	 * @returns {Promise<CacheEntry | null>} The cache entry or null
	 */
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

	/**
	 * Store a cache entry
	 * @param {string} key - The cache key
	 * @param {CacheEntry} entry - The cache entry
	 * @param {number} [ttl] - Time to live in seconds
	 * @param {number} [maxStaleAge] - Maximum stale age (unused in LRU)
	 * @returns {Promise<void>}
	 */
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

	/**
	 * Delete a cache entry
	 * @param {string} key - The cache key
	 * @returns {Promise<boolean>} True if deleted
	 */
	async delete(key: string): Promise<boolean> {
		return this.cache.delete(key);
	}

	/**
	 * Clear all cache entries
	 * @returns {Promise<void>}
	 */
	async clear(): Promise<void> {
		this.cache.clear();
	}

	/**
	 * Check if a cache entry exists
	 * @param {string} key - The cache key
	 * @returns {Promise<boolean>} True if exists
	 */
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

	/**
	 * Get the number of entries in the cache
	 * @returns {Promise<number>} The size
	 */
	async size(): Promise<number> {
		return this.cache.size;
	}
}

/**
 * Cache control directives type
 */
type CacheControlDirectives = Record<string, string | boolean>;

/**
 * Parse Cache-Control header into directives
 * @param {string | null} header - The Cache-Control header value
 * @returns {CacheControlDirectives} Parsed directives
 * @example
 * parseCacheControl("max-age=300, public") // { "max-age": "300", "public": true }
 */
function parseCacheControl(header: string | null): CacheControlDirectives {
	if (!header) return {};

	const directives: CacheControlDirectives = {};
	const parts = header.split(",").map((p) => p.trim());

	for (const part of parts) {
		const [key, value] = part.split("=").map((s) => s.trim());
		directives[key.toLowerCase()] = value || true;
	}

	return directives;
}

/**
 * Calculate TTL from Cache-Control header
 * @param {CacheControlDirectives} cacheControl - Parsed cache control directives
 * @returns {number | null} TTL in seconds or null
 */
function getTTLFromCacheControl(cacheControl: CacheControlDirectives): number | null {
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
 * Generate ETag from response body using specified hash algorithm
 * @param {string} body - The response body
 * @param {string} algorithm - The hash algorithm to use
 * @returns {Promise<string>} The generated ETag
 * @throws {Error} If the hash algorithm is not supported
 */
async function generateETag(body: string, algorithm: string): Promise<string> {
	try {
		return createHash(algorithm).update(body).digest("hex");
	} catch (error) {
		throw new Error(`Hash algorithm '${algorithm}' is not supported. Available algorithms: ${getHashes().join(", ")}`);
	}
}

/**
 * Validate if a hash algorithm is available
 * @param {string} algorithm - The hash algorithm to validate
 * @returns {boolean} True if the algorithm is available
 */
function isHashAlgorithmAvailable(algorithm: string): boolean {
	return getHashes().includes(algorithm);
}

/**
 * Check if path matches any pattern in the list
 * @param {string} path - The path to match
 * @param {(string | RegExp)[]} patterns - Array of patterns
 * @returns {boolean} True if matches any pattern
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
 * Creates a caching middleware that stores and serves responses from cache
 * based on the provided configuration.
 *
 * @template T - Context type parameter
 * @param {CacheConfig} [config={}] - Cache configuration
 * @returns {Middleware<T, B>} Cache middleware function
 *
 * @example
 * ```typescript
 * // Basic usage with default configuration
 * app.use(cache());
 *
 * // Custom configuration with LRU cache
 * app.use(cache({
 *   ttl: 600, // 10 minutes
 *   storage: new LRUCache(500),
 *   excludePaths: ['/api/auth', /^\/admin/]
 * }));
 *
 * // With Redis cache
 * app.use(cache({
 *   storage: new RedisCache(redisClient),
 *   staleWhileRevalidate: true,
 *   maxStaleAge: 3600 // 1 hour
 * }));
 * ```
 */
export function cache<T extends Record<string, unknown> = Record<string, unknown>, B extends Record<string, unknown> = Record<string, unknown>>(
	config: CacheConfig = {}
): Middleware<T, B> {
	// Apply defaults
	const options: Required<Omit<CacheConfig, "includePaths">> & Pick<CacheConfig, "includePaths"> = {
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
		excludePaths: [],
		includePaths: undefined,
		staleWhileRevalidate: false,
		maxStaleAge: 86400,
		hashAlgorithm: "blake2b512",
		...config,
	};

	/*
	// Validate hash algorithm on initialization (Disable validation because of a bug in Bun)
	if (!isHashAlgorithmAvailable(options.hashAlgorithm)) {
		const availableHashes = getHashes();
		throw new Error(`Hash algorithm '${options.hashAlgorithm}' is not supported. Available algorithms: ${availableHashes.join(", ")}`);
	}
	*/

	// Background revalidation tracker
	const revalidating = new Set<string>();

	/**
	 * Store response in cache
	 * @param {string} key - Cache key
	 * @param {Response} response - Response to cache
	 * @param {CacheControlDirectives} [cacheControl] - Parsed cache control
	 * @returns {Promise<void>}
	 */
	async function storeCachedResponse(key: string, response: Response, cacheControl?: CacheControlDirectives): Promise<void> {
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
			etag = await generateETag(body, options.hashAlgorithm);
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

	return async (ctx: Context<T, B>, next) => {
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
								// Ignore revalidation errors
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
				const etag = await generateETag(body, options.hashAlgorithm);

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
 * Get list of available hash algorithms for ETags
 *
 * Utility function to list all hash algorithms available for ETags.
 *
 * @returns {string[]} Array of available hash algorithm names
 *
 * @example
 * ```typescript
 * const algorithms = getAvailableHashAlgorithms();
 * console.log('Available algorithms:', algorithms);
 * // Output: ['blake2b512', 'blake2s256', 'md5', 'sha1', 'sha256', 'sha512', ...]
 * ```
 */
export function getAvailableHashAlgorithms(): string[] {
	return getHashes();
}

/**
 * Redis client interface
 * @interface RedisClient
 */
interface RedisClient {
	/** Get a value by key */
	get(key: string): Promise<string | null>;
	/** Set a value */
	set(key: string, value: string): Promise<"OK">;
	/** Set a value with expiry */
	setex(key: string, seconds: number, value: string): Promise<"OK">;
	/** Delete one or more keys */
	del(...keys: string[]): Promise<number>;
	/** Check if key exists */
	exists(key: string): Promise<number>;
	/** Get keys by pattern */
	keys(pattern: string): Promise<string[]>;
	/** Scan keys */
	scan(cursor: string, ...args: any[]): Promise<[string, string[]]>;
}

/**
 * Redis cache implementation
 *
 * Provides cache storage using Redis as the backend.
 * Supports all standard cache operations plus pattern-based deletion.
 *
 * @class RedisCache
 * @implements {CacheStorage}
 *
 * @example
 * ```typescript
 * // With ioredis
 * import Redis from 'ioredis';
 * const redis = new Redis();
 * const cache = new RedisCache(redis);
 *
 * // With node-redis
 * import { createClient } from 'redis';
 * const client = createClient();
 * await client.connect();
 * const cache = new RedisCache(client);
 * ```
 */
export class RedisCache implements CacheStorage {
	/** Redis client instance */
	private client: RedisClient;
	/** Key prefix for namespacing */
	private keyPrefix: string;
	/** Number of keys to scan at once */
	private scanCount: number;

	/**
	 * Create a new Redis cache instance
	 * @param {RedisClient} client - Redis client instance
	 * @param {string} [keyPrefix="cache:"] - Prefix for all cache keys
	 * @param {number} [scanCount=100] - Number of keys to scan per iteration
	 */
	constructor(client: RedisClient, keyPrefix = "cache:", scanCount = 100) {
		this.client = client;
		this.keyPrefix = keyPrefix;
		this.scanCount = scanCount;
	}

	/**
	 * Get the full Redis key with prefix
	 * @private
	 * @param {string} key - The cache key
	 * @returns {string} The prefixed key
	 */
	private getKey(key: string): string {
		return `${this.keyPrefix}${key}`;
	}

	/**
	 * Get a cache entry from Redis
	 * @param {string} key - The cache key
	 * @returns {Promise<CacheEntry | null>} The cache entry or null
	 */
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

	/**
	 * Store a cache entry in Redis
	 * @param {string} key - The cache key
	 * @param {CacheEntry} entry - The cache entry
	 * @param {number} [ttl] - Time to live in seconds
	 * @param {number} [maxStaleAge] - Maximum stale age in seconds
	 * @returns {Promise<void>}
	 */
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

	/**
	 * Delete a cache entry from Redis
	 * @param {string} key - The cache key
	 * @returns {Promise<boolean>} True if deleted
	 */
	async delete(key: string): Promise<boolean> {
		try {
			const result = await this.client.del(this.getKey(key));
			return result > 0;
		} catch (error) {
			return false;
		}
	}

	/**
	 * Clear all cache entries
	 * Uses SCAN to avoid blocking Redis
	 * @returns {Promise<void>}
	 */
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

	/**
	 * Check if a cache entry exists
	 * @param {string} key - The cache key
	 * @returns {Promise<boolean>} True if exists
	 */
	async has(key: string): Promise<boolean> {
		try {
			const exists = await this.client.exists(this.getKey(key));
			return exists > 0;
		} catch (error) {
			return false;
		}
	}

	/**
	 * Get the number of cache entries
	 * Uses SCAN to avoid blocking Redis
	 * @returns {Promise<number>} The number of entries
	 */
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
	 * @param {string} pattern - Pattern to match keys (supports * and ?)
	 * @returns {Promise<number>} Number of keys deleted
	 * @example
	 * ```typescript
	 * // Delete all POST cache entries
	 * await cache.deletePattern("POST:*");
	 * // Delete all entries for a specific path
	 * await cache.deletePattern("GET:/api/users/*");
	 * ```
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
 * Redis cache creation options
 * @interface RedisCreateOptions
 */
export interface RedisCreateOptions {
	/** Key prefix for namespacing */
	keyPrefix?: string;
	/** Number of keys to scan per iteration */
	scanCount?: number;
}

/**
 * Create a Redis cache instance with common Redis clients
 *
 * Helper function to create a Redis cache with proper configuration.
 * Supports both ioredis and node-redis clients.
 *
 * @param {RedisClient} client - Redis client instance
 * @param {RedisCreateOptions} [options] - Redis cache options
 * @returns {RedisCache} Configured Redis cache instance
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
 * // With custom options
 * const cache = createRedisCache(redis, {
 *   keyPrefix: 'myapp:cache:',
 *   scanCount: 200
 * });
 *
 * // Use in middleware
 * app.use(cache({ storage: cache }));
 * ```
 */
export function createRedisCache(client: RedisClient, options?: RedisCreateOptions): RedisCache {
	return new RedisCache(client, options?.keyPrefix, options?.scanCount);
}

/**
 * Cache invalidation options
 * @interface CacheInvalidateOptions
 */
export interface CacheInvalidateOptions {
	/** Cache storage to invalidate */
	storage: CacheStorage;
	/** Patterns to match for invalidation (Redis only) */
	patterns?: (string | RegExp)[];
	/** Specific keys to invalidate */
	keys?: string[];
}

/**
 * Cache utility functions interface
 * @interface CacheUtils
 */
export interface CacheUtils {
	/**
	 * Create a cache invalidation middleware
	 * @template T - Context type parameter
	 * @param {CacheInvalidateOptions} options - Invalidation options
	 * @returns {Middleware<T, B>} Invalidation middleware
	 */
	invalidate<T extends Record<string, unknown> = Record<string, unknown>, B extends Record<string, unknown> = Record<string, unknown>>(
		options: CacheInvalidateOptions
	): Middleware<T, B>;

	/**
	 * Clear entire cache
	 * @param {CacheStorage} storage - Cache storage to clear
	 * @returns {Promise<void>}
	 */
	clear(storage: CacheStorage): Promise<void>;

	/**
	 * Get cache statistics
	 * @param {CacheStorage} storage - Cache storage
	 * @returns {Promise<{ size: number }>} Cache statistics
	 */
	stats(storage: CacheStorage): Promise<{ size: number }>;
}

/**
 * Cache invalidation utilities
 *
 * Provides utility functions for cache management including
 * invalidation, clearing, and statistics.
 *
 * @type {CacheUtils}
 * @example
 * ```typescript
 * // Invalidate specific keys after mutation
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
 *
 * // Clear entire cache
 * await cacheUtils.clear(cache);
 *
 * // Get cache statistics
 * const stats = await cacheUtils.stats(cache);
 * console.log(`Cache has ${stats.size} entries`);
 * ```
 */
export const cacheUtils: CacheUtils = {
	/**
	 * Create a cache invalidation middleware
	 *
	 * Invalidates cache entries after successful mutations.
	 * Supports both specific key invalidation and pattern-based
	 * invalidation for Redis.
	 *
	 * @template T - Context type parameter
	 * @param {CacheInvalidateOptions} options - Invalidation options
	 * @returns {Middleware<T, B>} Middleware function
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
	invalidate<T extends Record<string, unknown> = Record<string, unknown>, B extends Record<string, unknown> = Record<string, unknown>>(
		options: CacheInvalidateOptions
	): Middleware<T, B> {
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
	 *
	 * Removes all entries from the cache storage.
	 *
	 * @param {CacheStorage} storage - Cache storage to clear
	 * @returns {Promise<void>}
	 *
	 * @example
	 * ```typescript
	 * // Clear all cache entries
	 * await cacheUtils.clear(cache);
	 * ```
	 */
	clear(storage: CacheStorage): Promise<void> {
		return storage.clear();
	},

	/**
	 * Get cache statistics
	 *
	 * Returns information about the cache including the number
	 * of stored entries.
	 *
	 * @param {CacheStorage} storage - Cache storage
	 * @returns {Promise<{ size: number }>} Cache statistics
	 *
	 * @example
	 * ```typescript
	 * const stats = await cacheUtils.stats(cache);
	 * console.log(`Cache has ${stats.size} entries`);
	 * ```
	 */
	async stats(storage: CacheStorage): Promise<{ size: number }> {
		return {
			size: await storage.size(),
		};
	},
};
