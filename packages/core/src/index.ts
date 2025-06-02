import type {
	BunServerInstance,
	Context,
	DenoServerInstance,
	ListenOptions,
	MatchResult,
	Method,
	Middleware,
	MiddlewareRoute,
	Next,
	NodeServerInstance,
	Route,
	Server,
} from "./types";

/**
 * Runtime detection utilities for identifying the current JavaScript runtime environment.
 * @internal
 */
const Runtime = {
	/** True if running in Bun runtime */
	isBun: typeof globalThis !== "undefined" && typeof (globalThis as any).Bun !== "undefined",
	/** True if running in Deno runtime */
	isDeno: typeof globalThis !== "undefined" && typeof (globalThis as any).Deno !== "undefined",
	/** True if running in Node.js runtime */
	isNode:
		typeof globalThis !== "undefined" &&
		typeof (globalThis as any).process !== "undefined" &&
		typeof (globalThis as any).Bun === "undefined" &&
		typeof (globalThis as any).Deno === "undefined",
};

/**
 * A node in the trie data structure used for efficient route matching.
 * Each node represents a path segment and can have static children, parameter children, or wildcard children.
 *
 * @template T - The type of the context state object
 */
class TrieNode<T extends Record<string, unknown> = Record<string, unknown>> {
	/** Map of static path segments to their corresponding child nodes */
	children = new Map<string, TrieNode<T>>();
	/** Parameter child node with its parameter name (e.g., for ":id" routes) */
	paramChild?: { node: TrieNode<T>; name: string };
	/** Wildcard child node (for "*" routes that match remaining path segments) */
	wildcardChild?: TrieNode<T>;
	/** Array of middleware handlers to execute when this node represents a complete route */
	handlers?: Middleware<T>[];
	/** HTTP method this node handles (GET, POST, etc.) */
	method?: Method;
	/** Unique identifier for tracking this route for removal */
	routeId?: string;

	/**
	 * Creates a new TrieNode
	 * @param segment - The path segment this node represents
	 */
	constructor(public segment?: string) {}
}

/** Frozen empty object used as default params to avoid object allocation */
const EMPTY_PARAMS = Object.freeze({});

/** Empty URLSearchParams instance used as default query params */
const EMPTY_SEARCH_PARAMS = new URLSearchParams();

/**
 * High-performance web framework with trie-based routing, middleware support, and extensive caching.
 *
 * Features:
 * - Fast trie-based route matching
 * - Middleware support with method and path filtering
 * - Route scoping and sub-applications
 * - Built-in caching for improved performance
 * - Support for all standard HTTP methods
 * - Parameter extraction and wildcard routes
 * - Dynamic route and middleware removal
 * - Custom error and 404 handlers
 *
 * @template T - The type of the context state object that will be shared across middleware
 *
 * @example
 * ```typescript
 * const app = new Web<{ user: User }>();
 *
 * app.get('/users/:id', async (ctx, next) => {
 *   const user = await getUser(ctx.params.id);
 *   ctx.set('user', user);
 *   return ctx.json(user);
 * });
 *
 * app.use('/admin', async (ctx, next) => {
 *   // Authentication middleware
 *   if (!ctx.get('user')?.isAdmin) {
 *     return ctx.json({ error: 'Unauthorized' }, 401);
 *   }
 *   await next();
 * });
 * ```
 */
export class Web<T extends Record<string, unknown> = Record<string, unknown>> {
	/** Array of all registered routes */
	private routes: (Route<T> & { id: string })[] = [];
	/** Array of all registered middleware */
	private middlewares: (MiddlewareRoute<T> & { id: string })[] = [];
	/** Cache for method-specific middleware to avoid filtering on each request */
	private methodMiddlewareCache = new Map<Method, MiddlewareRoute<T>[]>();
	/** Cache for parsed URLs to avoid repeated parsing */
	private urlCache = new Map<string, { pathname: string; searchParams?: URLSearchParams }>();
	/** Cache for path segments to avoid repeated splitting */
	private segmentCache = new Map<string, string[]>();
	/** Cache for compiled route matchers */
	private matcherCache = new Map<string, (urlSegments: string[]) => MatchResult>();
	/** Cache for frequently matched routes */
	private routeMatchCache = new Map<string, { handlers?: Middleware<T>[]; params: Record<string, string> } | null>();
	/** Counter for generating unique IDs */
	private idCounter = 0;

	/** Trie roots for each HTTP method for fast route matching */
	private roots: Record<Method, TrieNode<T>> = {
		GET: new TrieNode(),
		POST: new TrieNode(),
		PUT: new TrieNode(),
		DELETE: new TrieNode(),
		PATCH: new TrieNode(),
		OPTIONS: new TrieNode(),
		HEAD: new TrieNode(),
	};

	/**
	 * Creates a new Web framework instance
	 */
	constructor() {
		this.handle = this.handle.bind(this);
		this.handleBun = this.handleBun.bind(this);
	}

	/**
	 * Generates a unique ID for routes and middleware
	 * @private
	 */
	private generateId(): string {
		return `${Date.now()}-${++this.idCounter}`;
	}

	/**
	 * Clears all internal caches. Called automatically when routes or middleware are modified.
	 * @private
	 */
	private clearCaches() {
		this.methodMiddlewareCache.clear();
		this.urlCache.clear();
		this.segmentCache.clear();
		this.routeMatchCache.clear();
	}

	/**
	 * Rebuilds the trie structure from scratch. Used after route removal.
	 * @private
	 */
	private rebuildTrie() {
		// Clear all trie roots
		this.roots = {
			GET: new TrieNode(),
			POST: new TrieNode(),
			PUT: new TrieNode(),
			DELETE: new TrieNode(),
			PATCH: new TrieNode(),
			OPTIONS: new TrieNode(),
			HEAD: new TrieNode(),
		};

		// Rebuild from remaining routes
		for (const route of this.routes) {
			this.addRouteToTrie(route.method, route.path, route.handlers, route.id);
		}
	}

	/**
	 * Adds a route to the trie structure (internal method)
	 * @private
	 */
	private addRouteToTrie(method: Method, path: string, handlers: Middleware<T>[], routeId: string) {
		const segments = this.getPathSegments(path);
		let node = this.roots[method];

		for (const segment of segments) {
			if (segment === "*") {
				if (!node.wildcardChild) {
					node.wildcardChild = new TrieNode("*");
				}
				node = node.wildcardChild;
				break;
			} else if (segment.startsWith(":")) {
				const paramName = segment.slice(1);
				if (!node.paramChild) {
					node.paramChild = {
						node: new TrieNode(segment),
						name: paramName,
					};
				}
				node = node.paramChild.node;
			} else {
				if (!node.children.has(segment)) {
					node.children.set(segment, new TrieNode(segment));
				}
				node = node.children.get(segment)!;
			}
		}

		node.handlers = handlers;
		node.method = method;
		node.routeId = routeId;
	}

	/** Error handler function for handling uncaught errors */
	private errorHandler?: (err: Error, ctx: Context<T>) => Response | Promise<Response>;

	/** 404 Not Found handler function */
	private notFoundHandler?: (ctx: Context<T>) => Response | Promise<Response>;

	/**
	 * Sets a global error handler for the application.
	 * This handler will be called whenever an unhandled error occurs during request processing.
	 *
	 * @param handler - Function that takes an error and context, returns a Response
	 * @returns The Web instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * app.onError((err, ctx) => {
	 *   console.error('Application error:', err);
	 *   return ctx.json({ error: 'Internal Server Error' }, 500);
	 * });
	 * ```
	 */
	onError(handler: (err: Error, ctx: Context<T>) => Response | Promise<Response>): this {
		this.errorHandler = handler;
		return this;
	}

	/**
	 * Sets a custom 404 Not Found handler for the application.
	 * This handler will be called whenever a request doesn't match any registered routes.
	 *
	 * @param handler - Function that takes a context and returns a Response
	 * @returns The Web instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * // Simple text response
	 * app.onNotFound((ctx) => {
	 *   return ctx.text('Page not found', 404);
	 * });
	 *
	 * // JSON response with request details
	 * app.onNotFound((ctx) => {
	 *   return ctx.json({
	 *     error: 'Not Found',
	 *     path: ctx.req.url,
	 *     method: ctx.req.method
	 *   }, 404);
	 * });
	 *
	 * // HTML response with custom 404 page
	 * app.onNotFound((ctx) => {
	 *   return ctx.html(`
	 *     <!DOCTYPE html>
	 *     <html>
	 *       <head>
	 *         <title>404 - Page Not Found</title>
	 *         <style>
	 *           body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
	 *           h1 { color: #ff6b6b; }
	 *         </style>
	 *       </head>
	 *       <body>
	 *         <h1>404 - Page Not Found</h1>
	 *         <p>The page you're looking for doesn't exist.</p>
	 *         <a href="/">Go back home</a>
	 *       </body>
	 *     </html>
	 *   `, 404);
	 * });
	 * ```
	 */
	onNotFound(handler: (ctx: Context<T>) => Response | Promise<Response>): this {
		this.notFoundHandler = handler;
		return this;
	}

	/**
	 * Splits a path into segments and caches the result for performance.
	 *
	 * @param path - The URL path to split
	 * @returns Array of path segments (empty segments filtered out)
	 * @private
	 */
	private getPathSegments(path: string): string[] {
		let segments = this.segmentCache.get(path);
		if (segments) return segments;

		segments = path.split("/").filter(Boolean);

		// Cache with size limit
		if (this.segmentCache.size < 1000) {
			this.segmentCache.set(path, segments);
		}

		return segments;
	}

	/**
	 * Parses a URL into pathname and search parameters with caching for performance.
	 * Handles both absolute and relative URLs.
	 *
	 * @param url - The URL to parse
	 * @returns Object containing pathname and optional URLSearchParams
	 * @private
	 */
	private parseUrl(url: string): { pathname: string; searchParams?: URLSearchParams } {
		// Check cache first
		const cached = this.urlCache.get(url);
		if (cached) return cached;

		// Fast path: simple pathname-only URLs (most common case)
		if (url[0] === "/" && !url.includes("?") && !url.includes("#")) {
			const result = { pathname: url, searchParams: undefined };
			if (this.urlCache.size < 2000) {
				this.urlCache.set(url, result);
			}
			return result;
		}

		// Find query string start
		const queryStart = url.indexOf("?");
		const hashStart = url.indexOf("#");

		// Determine pathname end (before query or hash)
		let pathnameEnd = url.length;
		if (queryStart !== -1) pathnameEnd = Math.min(pathnameEnd, queryStart);
		if (hashStart !== -1) pathnameEnd = Math.min(pathnameEnd, hashStart);

		// Extract pathname
		let pathname: string;
		const protocolEnd = url.indexOf("://");
		if (protocolEnd !== -1) {
			// Absolute URL: find first '/' after protocol
			const hostStart = protocolEnd + 3;
			const pathStart = url.indexOf("/", hostStart);
			pathname = pathStart !== -1 ? url.slice(pathStart, pathnameEnd) : "/";
		} else {
			// Relative URL: use from start to pathname end
			pathname = url.slice(0, pathnameEnd) || "/";
		}

		// Extract and parse search params only if present
		let searchParams: URLSearchParams | undefined;
		if (queryStart !== -1) {
			const queryEnd = hashStart !== -1 ? hashStart : url.length;
			const queryString = url.slice(queryStart + 1, queryEnd);
			if (queryString.length > 0) {
				searchParams = new URLSearchParams(queryString);
			}
		}

		const result = { pathname, searchParams };

		// Cache with LRU eviction when at capacity
		if (this.urlCache.size >= 2000) {
			// Remove oldest entry (first key in Map)
			const firstKey = this.urlCache.keys().next().value;
			if (firstKey !== undefined) this.urlCache.delete(firstKey);
		}
		this.urlCache.set(url, result);

		return result;
	}

	/**
	 * Registers middleware that will run for matching requests.
	 * Middleware can be global, path-specific, or method and path specific.
	 *
	 * @param args - Variable arguments for different middleware registration patterns:
	 *   - `[handler]` - Global middleware that runs for all requests
	 *   - `[path, handler]` - Path-specific middleware
	 *   - `[method, path, handler]` - Method and path-specific middleware
	 * @returns The Web instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * // Global middleware
	 * app.use(async (ctx, next) => {
	 *   console.log(`${ctx.req.method} ${ctx.req.url}`);
	 *   await next();
	 * });
	 *
	 * // Path-specific middleware
	 * app.use('/api', async (ctx, next) => {
	 *   ctx.set('apiVersion', '1.0');
	 *   await next();
	 * });
	 *
	 * // Method and path-specific middleware
	 * app.use('POST', '/users', async (ctx, next) => {
	 *   // Validate request body
	 *   await next();
	 * });
	 * ```
	 */
	use(...args: [Middleware<T>] | [string, Middleware<T>] | [Method, string, Middleware<T>]): this {
		this.addMiddleware(...args);
		return this;
	}

	/**
	 * Removes middleware by its ID.
	 *
	 * @param id - The middleware ID returned from the use() method
	 * @returns true if middleware was found and removed, false otherwise
	 *
	 * @example
	 * ```typescript
	 * const middlewareId = app.use('/api', authMiddleware);
	 *
	 * // Later remove it
	 * const removed = app.removeMiddleware(middlewareId);
	 * console.log(removed ? 'Middleware removed' : 'Middleware not found');
	 * ```
	 */
	removeMiddleware(id: string): boolean {
		const initialLength = this.middlewares.length;
		this.middlewares = this.middlewares.filter((mw) => mw.id !== id);

		if (this.middlewares.length !== initialLength) {
			this.clearCaches();
			return true;
		}
		return false;
	}

	/**
	 * Removes all middleware matching the given criteria.
	 *
	 * @param criteria - Object with optional method and/or path to match
	 * @returns Number of middleware items removed
	 *
	 * @example
	 * ```typescript
	 * // Remove all middleware for a specific path
	 * const removed = app.removeMiddlewareBy({ path: '/api' });
	 *
	 * // Remove all POST middleware
	 * app.removeMiddlewareBy({ method: 'POST' });
	 *
	 * // Remove specific method and path combination
	 * app.removeMiddlewareBy({ method: 'GET', path: '/users' });
	 * ```
	 */
	removeMiddlewareBy(criteria: { method?: Method; path?: string }): number {
		const initialLength = this.middlewares.length;

		if (!criteria.method && !criteria.path) return 0;

		this.middlewares = this.middlewares.filter((mw) => {
			if (criteria.method && mw.method !== criteria.method) return true;
			if (criteria.path && mw.path !== criteria.path) return true;
			return false;
		});

		const removedCount = initialLength - this.middlewares.length;
		if (removedCount > 0) {
			this.clearCaches();
		}
		return removedCount;
	}

	/**
	 * Adds middleware using the specified pattern and returns an ID for later removal.
	 * This is an alternative to use() that returns an ID instead of the Web instance.
	 *
	 * @param args - Variable arguments for different middleware registration patterns
	 * @returns The middleware ID for later removal
	 *
	 * @example
	 * ```typescript
	 * // Global middleware
	 * const globalId = app.addMiddleware(async (ctx, next) => {
	 *   console.log(`${ctx.req.method} ${ctx.req.url}`);
	 *   await next();
	 * });
	 *
	 * // Path-specific middleware
	 * const pathId = app.addMiddleware('/api', async (ctx, next) => {
	 *   ctx.set('apiVersion', '1.0');
	 *   await next();
	 * });
	 *
	 * // Remove middleware later
	 * app.removeMiddleware(globalId);
	 * ```
	 */
	addMiddleware(...args: [Middleware<T>] | [string, Middleware<T>] | [Method, string, Middleware<T>]): string {
		this.clearCaches();
		const id = this.generateId();

		if (args.length === 1) {
			const [handler] = args;
			this.middlewares.push({
				id,
				match: () => ({ matched: true, params: {} }),
				handler,
			});
		} else if (args.length === 2) {
			const [path, handler] = args;
			const segments = this.getPathSegments(path);
			const match = this.getCachedMatcher(path, segments);
			this.middlewares.push({
				id,
				path,
				pathPrefix: getStaticPrefix(path),
				match: (url) => match(this.getPathSegments(url)),
				handler,
			});
		} else {
			const [method, path, handler] = args;
			const segments = this.getPathSegments(path);
			const match = this.getCachedMatcher(path, segments);
			this.middlewares.push({
				id,
				method,
				path,
				pathPrefix: getStaticPrefix(path),
				match: (url) => match(this.getPathSegments(url)),
				handler,
			});
		}
		return id;
	}

	/**
	 * Gets all registered middleware with their IDs and metadata.
	 *
	 * @returns Array of middleware information objects
	 *
	 * @example
	 * ```typescript
	 * const middlewares = app.getMiddlewares();
	 * middlewares.forEach(mw => {
	 *   console.log(`ID: ${mw.id}, Method: ${mw.method || 'ALL'}, Path: ${mw.path || 'ALL'}`);
	 * });
	 * ```
	 */
	getMiddlewares(): Array<{ id: string; method?: Method; path?: string }> {
		return this.middlewares.map((mw) => ({
			id: mw.id,
			method: mw.method,
			path: mw.path,
		}));
	}

	/**
	 * Gets or creates a cached matcher function for the given path pattern
	 * @private
	 */
	private getCachedMatcher(path: string, segments: string[]): (urlSegments: string[]) => MatchResult {
		let matcher = this.matcherCache.get(path);
		if (!matcher) {
			matcher = createPathMatcherSegments(segments);
			this.matcherCache.set(path, matcher);
		}
		return matcher;
	}

	/**
	 * Adds a route with the specified method, path, and handlers to the trie structure.
	 *
	 * @param method - HTTP method (GET, POST, etc.)
	 * @param path - URL path pattern (supports :param and * wildcards)
	 * @param handlers - One or more middleware handlers for this route
	 * @returns The route ID for later removal
	 *
	 * @example
	 * ```typescript
	 * const routeId = app.addRoute('GET', '/users/:id', async (ctx) => {
	 *   return ctx.json({ id: ctx.params.id });
	 * });
	 *
	 * // Remove it later
	 * app.removeRoute(routeId);
	 * ```
	 */
	addRoute(method: Method, path: string, ...handlers: Middleware<T>[]): string {
		this.clearCaches();
		const id = this.generateId();

		this.addRouteToTrie(method, path, handlers, id);

		// Automatically register OPTIONS route for CORS if not already present
		const hasOptionsRoute = this.routes.some((route) => route.method === "OPTIONS" && route.path === path);
		if (method !== "OPTIONS" && !hasOptionsRoute) {
			const optionsId = this.generateId();
			this.addRouteToTrie(
				"OPTIONS",
				path,
				[
					async (ctx) => {
						const response = new Response(null, { status: 204 });
						// CORS headers will be added by the CORS middleware
						return response;
					},
				],
				optionsId
			);
		}

		const matcher = this.getCachedMatcher(path, this.getPathSegments(path));
		this.routes.push({
			id,
			method,
			path,
			handlers,
			match: (url) => matcher(this.getPathSegments(url)),
		});

		return id;
	}

	/**
	 * Removes a route by its ID.
	 *
	 * @param id - The route ID returned from route registration methods
	 * @returns true if route was found and removed, false otherwise
	 *
	 * @example
	 * ```typescript
	 * const routeId = app.get('/users/:id', getUserHandler);
	 *
	 * // Later remove it
	 * const removed = app.removeRoute(routeId);
	 * console.log(removed ? 'Route removed' : 'Route not found');
	 * ```
	 */
	removeRoute(id: string): boolean {
		const initialLength = this.routes.length;
		this.routes = this.routes.filter((route) => route.id !== id);

		if (this.routes.length !== initialLength) {
			this.clearCaches();
			this.rebuildTrie();
			return true;
		}
		return false;
	}

	/**
	 * Removes all routes matching the given criteria.
	 *
	 * @param criteria - Object with optional method and/or path to match
	 * @returns Number of routes removed
	 *
	 * @example
	 * ```typescript
	 * // Remove all routes for a specific path
	 * const removed = app.removeRoutesBy({ path: '/users/:id' });
	 *
	 * // Remove all GET routes
	 * app.removeRoutesBy({ method: 'GET' });
	 *
	 * // Remove specific method and path combination
	 * app.removeRoutesBy({ method: 'POST', path: '/users' });
	 * ```
	 */
	removeRoutesBy(criteria: { method?: Method; path?: string }): number {
		const initialLength = this.routes.length;

		if (!criteria.method && !criteria.path) return 0;

		this.routes = this.routes.filter((route) => {
			if (criteria.method && route.method !== criteria.method) return true;
			if (criteria.path && route.path !== criteria.path) return true;
			return false;
		});

		const removedCount = initialLength - this.routes.length;
		if (removedCount > 0) {
			this.clearCaches();
			this.rebuildTrie();
		}
		return removedCount;
	}

	/**
	 * Gets all registered routes with their IDs and metadata.
	 *
	 * @returns Array of route information objects
	 *
	 * @example
	 * ```typescript
	 * const routes = app.getRoutes();
	 * routes.forEach(route => {
	 *   console.log(`ID: ${route.id}, ${route.method} ${route.path}`);
	 * });
	 * ```
	 */
	getRoutes(): Array<{ id: string; method: Method; path: string }> {
		return this.routes.map((route) => ({
			id: route.id,
			method: route.method,
			path: route.path,
		}));
	}

	/**
	 * Removes all routes and middleware, effectively resetting the application.
	 *
	 * @example
	 * ```typescript
	 * // Clear everything and start fresh
	 * app.clear();
	 *
	 * // Now add new routes
	 * app.get('/', handler);
	 * ```
	 */
	clear(): void {
		this.routes = [];
		this.middlewares = [];
		this.clearCaches();
		this.rebuildTrie();
	}

	/**
	 * Matches a method and path against the trie structure to find handlers and extract parameters.
	 *
	 * @param method - HTTP method to match
	 * @param path - URL path to match
	 * @returns Object with handlers and params if matched, null otherwise
	 *
	 * @example
	 * ```typescript
	 * const match = app.match('GET', '/users/123');
	 * if (match) {
	 *   console.log(match.params.id); // "123"
	 * }
	 * ```
	 */
	match(method: Method, path: string): { handlers?: Middleware<T>[]; params: Record<string, string> } | null {
		// Check route match cache first
		const cacheKey = `${method}:${path}`;
		const cached = this.routeMatchCache.get(cacheKey);
		if (cached !== undefined) return cached;

		const root = this.roots[method];
		if (!root) {
			this.routeMatchCache.set(cacheKey, null);
			return null;
		}

		const segments = this.getPathSegments(path);
		if (segments.length === 0) {
			// Root path "/"
			const result = root.handlers ? { handlers: root.handlers, params: EMPTY_PARAMS } : null;
			if (this.routeMatchCache.size < 500) {
				this.routeMatchCache.set(cacheKey, result);
			}
			return result;
		}

		const params: Record<string, string> = {};
		let node = root;
		let i = 0;

		while (node && i < segments.length) {
			const segment = segments[i];

			// Try static child first (most common case)
			const staticChild = node.children.get(segment!);
			if (staticChild) {
				node = staticChild;
				i++;
				continue;
			}

			// Try param child
			if (node.paramChild) {
				params[node.paramChild.name] = decodeURIComponent(segment!);
				node = node.paramChild.node;
				i++;
				continue;
			}

			// Try wildcard child
			if (node.wildcardChild) {
				params["*"] = segments.slice(i).join("/");
				node = node.wildcardChild;
				break;
			}

			if (this.routeMatchCache.size < 500) {
				this.routeMatchCache.set(cacheKey, null);
			}
			return null;
		}

		// Check if we've consumed all segments or hit a wildcard
		if (i === segments.length || node.segment === "*") {
			if (node.handlers) {
				const result = Object.keys(params).length === 0 ? { handlers: node.handlers, params: EMPTY_PARAMS } : { handlers: node.handlers, params };

				if (this.routeMatchCache.size < 500) {
					this.routeMatchCache.set(cacheKey, result);
				}
				return result;
			}
		}

		if (this.routeMatchCache.size < 500) {
			this.routeMatchCache.set(cacheKey, null);
		}
		return null;
	}

	/**
	 * Gets cached middleware that applies to a specific HTTP method.
	 *
	 * @param method - HTTP method to filter middleware for
	 * @returns Array of middleware routes that apply to the method
	 * @private
	 */
	private getMethodMiddlewares(method: Method): MiddlewareRoute<T>[] {
		if (this.methodMiddlewareCache.has(method)) {
			return this.methodMiddlewareCache.get(method)!;
		}

		const result = this.middlewares.filter((mw) => {
			if (mw.method && mw.method !== method) return false;
			return true;
		});

		this.methodMiddlewareCache.set(method, result);
		return result;
	}

	/**
	 * Creates a scoped sub-application that inherits middleware and routes with a path prefix.
	 * Useful for organizing routes and creating modular applications.
	 *
	 * @param path - Base path for the scope
	 * @param callback - Function that receives the scoped app instance to configure
	 * @returns The Web instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * app.scope('/api/v1', (api) => {
	 *   api.get('/users', async (ctx) => {
	 *     return ctx.json(await getUsers());
	 *   });
	 *
	 *   api.post('/users', async (ctx) => {
	 *     const user = await ctx.body<User>();
	 *     return ctx.json(await createUser(user));
	 *   });
	 * });
	 * // Routes will be available at /api/v1/users
	 * ```
	 */
	scope(path: string, callback: (scopeApp: this) => void): this {
		const scopedApp = new (this.constructor as any)() as this;
		callback(scopedApp);

		this.route(path, scopedApp);
		return this;
	}

	/**
	 * Mounts a sub-application at the specified path prefix.
	 * All routes from the sub-application will be prefixed with the given path.
	 *
	 * @param prefix - Path prefix to mount the sub-application at
	 * @param subApp - Web instance to mount
	 * @returns The Web instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * const adminApp = new Web();
	 * adminApp.get('/dashboard', handler);
	 *
	 * app.route('/admin', adminApp);
	 * // Dashboard will be available at /admin/dashboard
	 * ```
	 */
	route(prefix: string, subApp: this): this {
		const baseSegments = this.getPathSegments(prefix);

		for (const mw of subApp.middlewares) {
			const originalMatch = mw.match;
			const prefixedMatch = (url: string): MatchResult => {
				const urlSegments = this.getPathSegments(url);

				if (urlSegments.length < baseSegments.length) {
					return { matched: false, params: {} };
				}

				for (let i = 0; i < baseSegments.length; i++) {
					if (baseSegments[i] !== urlSegments[i]) {
						return { matched: false, params: {} };
					}
				}

				const subSegments = urlSegments.slice(baseSegments.length);
				const subPath = "/" + subSegments.join("/");

				return originalMatch(subPath);
			};

			this.middlewares.push({
				...mw,
				id: this.generateId(), // Generate new ID for the parent app
				match: prefixedMatch,
				path: prefix + (mw.path ?? ""),
				pathPrefix: getStaticPrefix(prefix + (mw.path ?? "")),
			});
		}

		for (const route of subApp.routes) {
			const newPath = joinPaths(prefix, route.path);
			this.addRoute(route.method, newPath, ...route.handlers);
		}
		return this;
	}

	/**
	 * Registers a GET route handler.
	 *
	 * @param path - URL path pattern (supports :param and * wildcards)
	 * @param handlers - One or more middleware handlers
	 * @returns The Web instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * app.get('/users/:id', async (ctx) => {
	 *   const user = await getUserById(ctx.params.id);
	 *   return ctx.json(user);
	 * });
	 * ```
	 */
	get(path: string, ...handlers: Middleware<T>[]): this {
		this.addRoute("GET", path, ...handlers);
		return this;
	}

	/**
	 * Registers a POST route handler.
	 *
	 * @param path - URL path pattern
	 * @param handlers - One or more middleware handlers
	 * @returns The Web instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * app.post('/users', async (ctx) => {
	 *   const userData = await ctx.body<CreateUserRequest>();
	 *   const user = await createUser(userData);
	 *   return ctx.json(user, 201);
	 * });
	 * ```
	 */
	post(path: string, ...handlers: Middleware<T>[]): this {
		this.addRoute("POST", path, ...handlers);
		return this;
	}

	/**
	 * Registers a PUT route handler for complete resource updates.
	 * PUT is typically used when you want to replace an entire resource.
	 *
	 * @param path - URL path pattern
	 * @param handlers - One or more middleware handlers
	 * @returns The Web instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * // Basic PUT route
	 * app.put('/users/:id', async (ctx) => {
	 *   const userData = await ctx.body<User>();
	 *   const updatedUser = await replaceUser(ctx.params.id, userData);
	 *   return ctx.json(updatedUser);
	 * });
	 *
	 * // PUT with optimistic concurrency control
	 * app.put('/documents/:id',
	 *   async (ctx) => {
	 *     const doc = await ctx.body<Document>();
	 *     if (ctx.req.headers.get('If-Match') !== doc.version) {
	 *       return ctx.json({ error: 'Version mismatch' }, 412);
	 *     }
	 *     const savedDoc = await saveDocument(doc);
	 *     return ctx.json(savedDoc);
	 *   }
	 * );
	 * ```
	 */
	put(path: string, ...handlers: Middleware<T>[]): this {
		this.addRoute("PUT", path, ...handlers);
		return this;
	}

	/**
	 * Registers a DELETE route handler.
	 *
	 * @param path - URL path pattern
	 * @param handlers - One or more middleware handlers
	 * @returns The Web instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * app.delete('/users/:id', async (ctx) => {
	 *   await deleteUser(ctx.params.id);
	 *   return new Response(null, { status: 204 });
	 * });
	 * ```
	 */
	delete(path: string, ...handlers: Middleware<T>[]): this {
		this.addRoute("DELETE", path, ...handlers);
		return this;
	}

	/**
	 * Registers a PATCH route handler for partial updates to resources.
	 * PATCH is typically used when you want to update only specific fields of a resource.
	 *
	 * @param path - URL path pattern (supports :param and * wildcards)
	 * @param handlers - One or more middleware handlers
	 * @returns The Web instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * // Basic PATCH route
	 * app.patch('/users/:id', async (ctx) => {
	 *   const updates = await ctx.body<Partial<User>>();
	 *   const updatedUser = await updateUser(ctx.params.id, updates);
	 *   return ctx.json(updatedUser);
	 * });
	 *
	 * // PATCH with validation middleware
	 * app.patch('/articles/:id',
	 *   validateArticleUpdate, // middleware that validates the patch body
	 *   async (ctx) => {
	 *     const updates = ctx.get('validatedUpdates');
	 *     const article = await updateArticle(ctx.params.id, updates);
	 *     return ctx.json(article);
	 *   }
	 * );
	 * ```
	 */
	patch(path: string, ...handlers: Middleware<T>[]): this {
		this.addRoute("PATCH", path, ...handlers);
		return this;
	}

	/**
	 * Registers an OPTIONS route handler for CORS preflight requests.
	 * OPTIONS requests are typically used to determine what HTTP methods
	 * are supported for a given endpoint.
	 *
	 * @param path - URL path pattern
	 * @param handlers - One or more middleware handlers
	 * @returns The Web instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * // Basic OPTIONS handler
	 * app.options('/users', (ctx) => {
	 *   return new Response(null, {
	 *     headers: {
	 *       'Allow': 'GET, POST, OPTIONS',
	 *       'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	 *       'Access-Control-Allow-Headers': 'Content-Type'
	 *     }
	 *   });
	 * });
	 *
	 * // Automatic CORS handling
	 * app.options('*', (ctx) => {
	 *   return new Response(null, {
	 *     headers: {
	 *       'Access-Control-Allow-Origin': '*',
	 *       'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
	 *       'Access-Control-Allow-Headers': 'Content-Type, Authorization'
	 *     }
	 *   });
	 * });
	 * ```
	 */
	options(path: string, ...handlers: Middleware<T>[]): this {
		this.addRoute("OPTIONS", path, ...handlers);
		return this;
	}

	/**
	 * Registers a HEAD route handler.
	 * HEAD responses automatically strip the response body while preserving headers and status.
	 *
	 * @param path - URL path pattern
	 * @param handlers - One or more middleware handlers
	 * @returns The Web instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * app.head('/users/:id', async (ctx) => {
	 *   const exists = await userExists(ctx.params.id);
	 *   return exists ? new Response() : new Response(null, { status: 404 });
	 * });
	 * ```
	 */
	head(path: string, ...handlers: Middleware<T>[]): this {
		this.addRoute(
			"HEAD",
			path,
			...handlers.map((handler) => async (ctx: Context<T>, next: Next) => {
				const res = await handler(ctx, next);
				if (res instanceof Response) {
					// Strip the body for HEAD requests
					return new Response(null, {
						status: res.status,
						headers: res.headers,
					});
				}
				return res;
			})
		);
		return this;
	}

	/**
	 * Creates a context object for the current request with helper methods.
	 *
	 * @param req - The incoming Request object
	 * @param params - URL parameters extracted from the path
	 * @param parsedUrl - Pre-parsed URL components
	 * @returns Context object with request data and helper methods
	 * @private
	 */
	private createContext(
		req: Request,
		params: Record<string, string>,
		parsedUrl: { pathname: string; searchParams?: URLSearchParams },
		clientIp?: string
	): Context<T> {
		// Initialize response headers storage
		const responseHeaders = new Headers();

		// Pre-allocate state object
		const state = {} as T;

		const ctx: Context<T> = {
			req,
			params,
			state,
			clientIp,
			header: (name: string, value: string) => {
				responseHeaders.set(name, value);
			},
			set: (key: keyof T, value: T[keyof T]) => {
				state[key] = value;
			},
			get: (key) => state[key],
			redirect: (url: string, status = 302) => {
				responseHeaders.set("Location", url);
				return new Response(null, {
					status,
					headers: responseHeaders,
				});
			},
			body: async <U>(): Promise<U> => {
				if (!req.body) return {} as U;
				const type = req.headers.get("content-type") ?? "";
				if (type.includes("application/x-www-form-urlencoded")) {
					const formData = await req.formData();
					return Object.fromEntries(formData.entries()) as U;
				}
				return type.includes("application/json") ? (req.json() as Promise<U>) : ({} as U);
			},
			json: (data: unknown, status = 200, headers?: Record<string, string>) => {
				const allHeaders = headers ? new Headers(responseHeaders) : responseHeaders;
				allHeaders.set("Content-Type", "application/json");
				if (headers) {
					Object.entries(headers).forEach(([name, value]) => {
						allHeaders.set(name, value);
					});
				}
				return new Response(JSON.stringify(data), {
					status,
					headers: allHeaders,
				});
			},
			text: (data: string | null | undefined, status = 200, headers?: Record<string, string>) => {
				const allHeaders = headers ? new Headers(responseHeaders) : responseHeaders;
				allHeaders.set("Content-Type", "text/plain");
				if (headers) {
					Object.entries(headers).forEach(([name, value]) => {
						allHeaders.set(name, value);
					});
				}
				return new Response(data, {
					status,
					headers: allHeaders,
				});
			},
			html: (html: string | null | undefined, status = 200, headers?: Record<string, string>) => {
				const allHeaders = headers ? new Headers(responseHeaders) : responseHeaders;
				allHeaders.set("Content-Type", "text/html; charset=utf-8");
				if (headers) {
					Object.entries(headers).forEach(([name, value]) => {
						allHeaders.set(name, value);
					});
				}
				return new Response(html, {
					status,
					headers: allHeaders,
				});
			},
			query: () => parsedUrl.searchParams || EMPTY_SEARCH_PARAMS,
		};

		return ctx;
	}

	/**
	 * Creates a 404 Not Found response using the custom handler if set.
	 * @private
	 */
	private async createNotFoundResponse(req: Request, parsedUrl: { pathname: string; searchParams?: URLSearchParams }, clientIp?: string): Promise<Response> {
		if (this.notFoundHandler) {
			// Create a minimal context for the 404 handler
			const ctx = this.createContext(req, EMPTY_PARAMS, parsedUrl, clientIp);
			return this.notFoundHandler(ctx);
		}
		return new Response("Not Found", { status: 404 });
	}

	/**
	 * Main request handler that processes incoming requests through the middleware chain and route handlers.
	 * This method implements several optimization paths for different scenarios:
	 * - Ultra-fast path: no middleware, no parameters, single handler
	 * - Fast path: no middleware, might have parameters
	 * - Full path: includes middleware processing
	 *
	 * @param req - The incoming Request object
	 * @returns Promise that resolves to a Response object
	 *
	 * @example
	 * ```typescript
	 * // Use with a server
	 * const server = Bun.serve({
	 *   port: 3000,
	 *   fetch: app.handle,
	 * });
	 *
	 * // Or with other runtimes
	 * addEventListener('fetch', (event) => {
	 *   event.respondWith(app.handle(event.request));
	 * });
	 * ```
	 */
	async handle(req: Request): Promise<Response> {
		const method = req.method as Method;
		const parsedUrl = this.parseUrl(req.url);
		const path = parsedUrl.pathname;

		try {
			// Match route first
			const matched = this.match(method, path);
			if (!matched) {
				return this.createNotFoundResponse(req, parsedUrl);
			}

			// Ultra-fast path: no middlewares, no parameters, single handler
			if (this.middlewares.length === 0 && matched.params === EMPTY_PARAMS && matched.handlers?.length === 1) {
				const ctx = this.createContext(req, EMPTY_PARAMS, parsedUrl);
				const result = await matched.handlers[0](ctx, async () => {});
				return result instanceof Response ? result : new Response("No response returned by handler", { status: 500 });
			}

			// Fast path: no middlewares, might have parameters
			if (this.middlewares.length === 0) {
				const ctx = this.createContext(req, matched.params, parsedUrl);

				// Optimized handler execution without allocation
				const handlers = matched.handlers;
				if (handlers) {
					for (let i = 0; i < handlers.length; i++) {
						const result = await handlers[i](ctx, async () => {});
						if (result instanceof Response) {
							return result;
						}
					}
				}

				return new Response("No response returned by handler", { status: 500 });
			}

			// Full path with middleware processing
			const methodMiddlewares = this.getMethodMiddlewares(method);
			let finalParams = matched.params;

			// Pre-allocate middleware array with estimated size
			const middlewares: Middleware<T>[] = new Array(methodMiddlewares.length);
			let middlewareCount = 0;

			// Only process middlewares if there are any
			if (methodMiddlewares.length > 0) {
				// Pre-filter middlewares by path prefix before expensive matching
				for (let i = 0; i < methodMiddlewares.length; i++) {
					const mw = methodMiddlewares[i];

					// Skip expensive match() call if path doesn't start with middleware's static prefix
					if (mw.pathPrefix && !path.startsWith(mw.pathPrefix)) {
						continue;
					}

					const matchResult = mw.match(path);
					if (matchResult.matched) {
						// Only create new params object if we have parameters to merge
						if (Object.keys(matchResult.params).length > 0) {
							if (finalParams === EMPTY_PARAMS) {
								finalParams = { ...matchResult.params };
							} else {
								finalParams = { ...finalParams, ...matchResult.params };
							}
						}
						middlewares[middlewareCount++] = mw.handler;
					}
				}
			}

			// Create context once
			const ctx = this.createContext(req, finalParams, parsedUrl);

			// Execute middleware and handlers
			const handlers = matched.handlers;

			// Build the complete middleware chain
			const allMiddleware: Middleware<T>[] = [];

			// Add middlewares first
			for (let i = 0; i < middlewareCount; i++) {
				allMiddleware.push(middlewares[i]);
			}

			// Add route handlers
			if (handlers) {
				allMiddleware.push(...handlers);
			}

			// If there are no handlers at all (neither middleware nor route handlers)
			if (allMiddleware.length === 0) {
				return this.createNotFoundResponse(req, parsedUrl);
			}

			// Create the composed middleware chain
			let currentIndex = 0;
			let response: any = undefined;

			const dispatch = async (): Promise<Response | void> => {
				if (currentIndex >= allMiddleware.length) {
					return;
				}

				const middleware = allMiddleware[currentIndex++];
				const result = await middleware(ctx, dispatch);

				// Store the response if one was returned
				if (result instanceof Response) {
					response = result;
				}

				return result;
			};

			// Start the middleware chain
			await dispatch();

			if (response instanceof Response) {
				return response;
			}

			// If no response was returned, check if we had actual route handlers
			// If we only had middleware (no route handlers), this is a 404
			if (!handlers || handlers.length === 0) {
				return this.createNotFoundResponse(req, parsedUrl);
			}

			// If we had route handlers but they didn't return a response, that's a 500
			return new Response("No response returned by handler", { status: 500 });
		} catch (err) {
			if (this.errorHandler) {
				// We need to create a minimal context for error handling
				const errorCtx: Context<T> = {
					req,
					params: EMPTY_PARAMS,
					state: {} as T,
					// Minimal implementations for error handling
					text: (data, status = 500) => new Response(data, { status }),
					json: (data, status = 500) =>
						new Response(JSON.stringify(data), {
							status,
							headers: new Headers({ "Content-Type": "application/json" }),
						}),
					html: (html, status = 500) =>
						new Response(html, {
							status,
							headers: new Headers({ "Content-Type": "text/html; charset=utf-8" }),
						}),
					query: () => parsedUrl.searchParams || EMPTY_SEARCH_PARAMS,
					body: async () => ({} as any),
					header: () => {},
					set: () => {},
					get: () => undefined as any,
					redirect: () => new Response(null, { status: 302 }),
				};
				return this.errorHandler(err as Error, errorCtx);
			}
			return new Response("Internal Server Error", { status: 500 });
		}
	}

	/**
	 * Internal handler that processes requests with a known client IP.
	 * This is the common implementation used by both runtime-specific handlers.
	 *
	 * @param req - The incoming Request object
	 * @param clientIp - The client IP address (optional)
	 * @returns Promise that resolves to a Response object
	 *
	 * @internal
	 */
	private async handleWithIp(req: Request, clientIp?: string): Promise<Response> {
		const method = req.method as Method;
		const parsedUrl = this.parseUrl(req.url);
		const path = parsedUrl.pathname;

		try {
			// Match route first
			const matched = this.match(method, path);
			if (!matched) {
				return this.createNotFoundResponse(req, parsedUrl, clientIp);
			}

			// Ultra-fast path: no middlewares, no parameters, single handler
			if (this.middlewares.length === 0 && matched.params === EMPTY_PARAMS && matched.handlers?.length === 1) {
				const ctx = this.createContext(req, EMPTY_PARAMS, parsedUrl, clientIp);
				const result = await matched.handlers[0](ctx, async () => {});
				return result instanceof Response ? result : new Response("No response returned by handler", { status: 500 });
			}

			// Fast path: no middlewares, might have parameters
			if (this.middlewares.length === 0) {
				const ctx = this.createContext(req, matched.params, parsedUrl, clientIp);

				// Optimized handler execution without allocation
				const handlers = matched.handlers;
				if (handlers) {
					for (let i = 0; i < handlers.length; i++) {
						const result = await handlers[i](ctx, async () => {});
						if (result instanceof Response) {
							return result;
						}
					}
				}

				return new Response("No response returned by handler", { status: 500 });
			}

			// Full path with middleware processing
			const methodMiddlewares = this.getMethodMiddlewares(method);
			let finalParams = matched.params;

			// Pre-allocate middleware array with estimated size
			const middlewares: Middleware<T>[] = new Array(methodMiddlewares.length);
			let middlewareCount = 0;

			// Only process middlewares if there are any
			if (methodMiddlewares.length > 0) {
				// Pre-filter middlewares by path prefix before expensive matching
				for (let i = 0; i < methodMiddlewares.length; i++) {
					const mw = methodMiddlewares[i];

					// Skip expensive match() call if path doesn't start with middleware's static prefix
					if (mw.pathPrefix && !path.startsWith(mw.pathPrefix)) {
						continue;
					}

					const matchResult = mw.match(path);
					if (matchResult.matched) {
						// Only create new params object if we have parameters to merge
						if (Object.keys(matchResult.params).length > 0) {
							if (finalParams === EMPTY_PARAMS) {
								finalParams = { ...matchResult.params };
							} else {
								finalParams = { ...finalParams, ...matchResult.params };
							}
						}
						middlewares[middlewareCount++] = mw.handler;
					}
				}
			}

			// Create context once
			const ctx = this.createContext(req, finalParams, parsedUrl, clientIp);

			// Execute middleware and handlers
			const handlers = matched.handlers;

			// Build the complete middleware chain
			const allMiddleware: Middleware<T>[] = [];

			// Add middlewares first
			for (let i = 0; i < middlewareCount; i++) {
				allMiddleware.push(middlewares[i]);
			}

			// Add route handlers
			if (handlers) {
				allMiddleware.push(...handlers);
			}

			// If there are no handlers at all (neither middleware nor route handlers)
			if (allMiddleware.length === 0) {
				return this.createNotFoundResponse(req, parsedUrl, clientIp);
			}

			// Create the composed middleware chain
			let currentIndex = 0;
			let response: any = undefined;

			const dispatch = async (): Promise<Response | void> => {
				if (currentIndex >= allMiddleware.length) {
					return;
				}

				const middleware = allMiddleware[currentIndex++];
				const result = await middleware(ctx, dispatch);

				// Store the response if one was returned
				if (result instanceof Response) {
					response = result;
				}

				return result;
			};

			// Start the middleware chain
			await dispatch();

			if (response instanceof Response) {
				return response;
			}

			// If no response was returned, check if we had actual route handlers
			// If we only had middleware (no route handlers), this is a 404
			if (!handlers || handlers.length === 0) {
				return this.createNotFoundResponse(req, parsedUrl, clientIp);
			}

			// If we had route handlers but they didn't return a response, that's a 500
			return new Response("No response returned by handler", { status: 500 });
		} catch (err) {
			if (this.errorHandler) {
				// We need to create a minimal context for error handling
				const errorCtx: Context<T> = {
					req,
					params: EMPTY_PARAMS,
					state: {} as T,
					clientIp,
					// Minimal implementations for error handling
					text: (data, status = 500) => new Response(data, { status }),
					json: (data, status = 500) =>
						new Response(JSON.stringify(data), {
							status,
							headers: new Headers({ "Content-Type": "application/json" }),
						}),
					html: (html, status = 500) =>
						new Response(html, {
							status,
							headers: new Headers({ "Content-Type": "text/html; charset=utf-8" }),
						}),
					query: () => parsedUrl.searchParams || EMPTY_SEARCH_PARAMS,
					body: async () => ({} as any),
					header: () => {},
					set: () => {},
					get: () => undefined as any,
					redirect: () => new Response(null, { status: 302 }),
				};
				return this.errorHandler(err as Error, errorCtx);
			}
			return new Response("Internal Server Error", { status: 500 });
		}
	}

	/**
	 * Request handler optimized for Bun runtime with automatic IP extraction.
	 * Uses Bun's server request info for reliable client IP detection.
	 *
	 * @param req - The incoming Request object
	 * @param server - Bun server instance
	 * @returns Promise that resolves to a Response object
	 *
	 * @example
	 * ```typescript
	 * Bun.serve({
	 *   port: 3000,
	 *   hostname: 'localhost',
	 *   fetch: app.handleBun
	 * });
	 * ```
	 */
	async handleBun(req: Request, server: unknown): Promise<Response> {
		// Extract client IP from Bun's server object
		const clientIp = (server as any)?.requestIP?.(req)?.address;
		return this.handleWithIp(req, clientIp);
	}

	/**
	 * Request handler optimized for Deno runtime with automatic IP extraction.
	 * Uses Deno's ServeHandlerInfo for reliable client IP detection.
	 *
	 * @param req - The incoming Request object
	 * @param info - Deno.ServeHandlerInfo instance for accessing runtime-specific features
	 * @returns Promise that resolves to a Response object
	 *
	 * @example
	 * ```typescript
	 * Deno.serve({
	 *     port: 3000
	 *   },
	 *   (req, info) => app.handleDeno(req, info)
	 * );
	 * ```
	 */
	async handleDeno(req: Request, info: unknown): Promise<Response> {
		// Extract client IP from Deno's ServeHandlerInfo
		const clientIp = (info as any)?.remoteAddr?.hostname;
		return this.handleWithIp(req, clientIp);
	}

	/**
	 * Request handler for Node.js that handles both request and response.
	 * Automatically converts between Node.js and Web APIs and extracts client IP.
	 *
	 * @param nodeReq - Node.js IncomingMessage object
	 * @param nodeRes - Node.js ServerResponse object
	 * @returns Promise that resolves when response is sent
	 *
	 * @example
	 * ```typescript
	 * import { createServer } from "http";
	 *
	 * createServer((req, res) => app.handleNode(req, res)).listen(3000);
	 * ```
	 */
	async handleNode(nodeReq: unknown, nodeRes: unknown): Promise<void> {
		const req = nodeReq as any;
		const res = nodeRes as any;

		try {
			// Extract client IP from Node.js request
			const clientIp: string | undefined = req.socket?.remoteAddress;

			// Convert Node.js request to Web Request
			const host = req.headers.host || "localhost";
			const protocol = req.socket?.encrypted ? "https" : "http";
			const url = `${protocol}://${host}${req.url}`;

			// Create headers
			const headers = new Headers();
			for (const [key, value] of Object.entries(req.headers)) {
				if (value) {
					if (Array.isArray(value)) {
						value.forEach((v) => headers.append(key, v));
					} else {
						headers.set(key, value as string);
					}
				}
			}

			// Handle request body
			let body: BodyInit | null = null;
			if (req.method !== "GET" && req.method !== "HEAD") {
				// Collect body data
				const chunks: Buffer[] = [];
				await new Promise<void>((resolve, reject) => {
					req.on("data", (chunk: Buffer) => chunks.push(chunk));
					req.on("end", () => resolve());
					req.on("error", reject);
				});

				if (chunks.length > 0) {
					body = Buffer.concat(chunks);
				}
			}

			// Create Web Request
			const webRequest = new Request(url, {
				method: req.method,
				headers,
				body,
				// @ts-ignore - Node.js doesn't have duplex, but it's safe to ignore
				duplex: "half",
			});

			// Handle the request with extracted IP
			const response = await this.handleWithIp(webRequest, clientIp);

			// Convert Web Response to Node.js response
			const responseHeaders: Record<string, string> = {};
			response.headers.forEach((value, key) => {
				responseHeaders[key] = value;
			});

			res.writeHead(response.status, responseHeaders);

			// Stream the response body
			if (response.body) {
				const reader = response.body.getReader();
				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						res.write(value);
					}
				} finally {
					reader.releaseLock();
				}
			}

			res.end();
		} catch (error) {
			// Handle errors
			if (!res.headersSent) {
				res.writeHead(500, { "Content-Type": "text/plain" });
			}
			res.end("Internal Server Error");
		}
	}

	/**
	 * Starts a server with automatic runtime detection.
	 * Automatically selects the appropriate server implementation based on the runtime environment.
	 *
	 * @param {ListenOptions} options - Server configuration options
	 * @returns {Promise<Server>} Promise that resolves to a Server instance
	 * @throws {Error} If the runtime is not supported
	 *
	 * @example
	 * ```typescript
	 * // Basic usage with default options
	 * const server = await app.listen({ port: 3000 });
	 * console.log(`Server running on ${server.runtime} at http://localhost:${server.port}`);
	 *
	 * // With startup callback
	 * await app.listen({
	 *   port: 8080,
	 *   hostname: '0.0.0.0',
	 *   onListen: ({ port, hostname, runtime }) => {
	 *     console.log(`✅ ${runtime} server running at http://${hostname}:${port}`);
	 *   }
	 * });
	 *
	 * // With HTTPS in Node.js
	 * await app.listen({
	 *   port: 443,
	 *   node: {
	 *     https: true,
	 *     key: fs.readFileSync('./key.pem'),
	 *     cert: fs.readFileSync('./cert.pem')
	 *   }
	 * });
	 *
	 * // With TLS in Deno
	 * await app.listen({
	 *   port: 443,
	 *   deno: {
	 *     key: './key.pem',
	 *     cert: './cert.pem'
	 *   }
	 * });
	 *
	 * // With TLS in Bun
	 * await app.listen({
	 *   port: 443,
	 *   bun: {
	 *     tls: {
	 *       key: Bun.file('./key.pem'),
	 *       cert: Bun.file('./cert.pem')
	 *     }
	 *   }
	 * });
	 *
	 * // Gracefully stop the server
	 * await server.stop();
	 * ```
	 */
	async listen(options: ListenOptions = {}): Promise<Server> {
		const { port = 3000, hostname = "localhost", onListen, node: nodeOptions = {}, deno: denoOptions = {}, bun: bunOptions = {} } = options;

		// Detect runtime and start appropriate server
		if (Runtime.isBun) {
			// Bun runtime
			const bunGlobal = globalThis as any;
			const serverConfig: Record<string, any> = {
				port,
				hostname,
				fetch: this.handleBun.bind(this),
				...bunOptions,
			};

			const bunServer = bunGlobal.Bun.serve(serverConfig) as BunServerInstance;

			const server: Server = {
				port: bunServer.port,
				hostname: bunServer.hostname || hostname,
				runtime: "bun",
				instance: bunServer,
				stop: async (): Promise<void> => {
					bunServer.stop();
				},
			};

			if (onListen) {
				onListen({
					port: server.port,
					hostname: server.hostname,
					runtime: server.runtime,
				});
			}

			return server;
		} else if (Runtime.isDeno) {
			// Deno runtime
			const denoGlobal = globalThis as any;
			const serverConfig: Record<string, any> = {
				port,
				hostname,
				...denoOptions,
			};

			const handler = (req: Request, info: unknown): Promise<Response> => {
				return this.handleDeno(req, info);
			};

			const denoServer = denoGlobal.Deno.serve(serverConfig, handler) as DenoServerInstance;

			const server: Server = {
				port,
				hostname,
				runtime: "deno",
				instance: denoServer,
				stop: async (): Promise<void> => {
					await denoServer.shutdown();
				},
			};

			if (onListen) {
				onListen({
					port: server.port,
					hostname: server.hostname,
					runtime: server.runtime,
				});
			}

			return server;
		} else if (Runtime.isNode) {
			// Node.js runtime
			const module: "http" | "https" = nodeOptions.https ? "https" : "http";
			const { createServer } = await import(module);

			let nodeServer: NodeServerInstance;

			const requestHandler = (req: any, res: any): void => {
				this.handleNode(req, res).catch((err: Error) => {
					if (!res.headersSent) {
						res.writeHead(500, { "Content-Type": "text/plain" });
						res.end("Internal Server Error");
					}
				});
			};

			if (nodeOptions.https) {
				// HTTPS server
				const httpsOptions: Record<string, any> = {
					key: nodeOptions.key,
					cert: nodeOptions.cert,
				};
				nodeServer = (createServer as any)(httpsOptions, requestHandler) as NodeServerInstance;
			} else {
				// HTTP server
				nodeServer = createServer(requestHandler) as NodeServerInstance;
			}

			// Start listening
			await new Promise<void>((resolve, reject) => {
				const errorHandler = (err: Error): void => {
					reject(err);
				};

				nodeServer.on("error", errorHandler);

				nodeServer.listen(port, hostname, () => {
					nodeServer.off("error", errorHandler);
					resolve();
				});
			});

			const server: Server = {
				port,
				hostname,
				runtime: "node",
				instance: nodeServer,
				stop: async (): Promise<void> => {
					return new Promise<void>((resolve, reject) => {
						nodeServer.close((err?: Error) => {
							if (err) {
								reject(err);
							} else {
								resolve();
							}
						});
					});
				},
			};

			if (onListen) {
				onListen({
					port: server.port,
					hostname: server.hostname,
					runtime: server.runtime,
				});
			}

			return server;
		} else {
			throw new Error(`Unsupported runtime. This framework supports Bun, Deno, and Node.js.`);
		}
	}
}

/**
 * Extracts the static prefix from a path pattern by finding the longest initial segment
 * that doesn't contain parameters (:) or wildcards (*). Used for quick middleware filtering.
 *
 * @param path - The path pattern to analyze (e.g., "/users/:id/profile")
 * @returns The static prefix (e.g., "/users") or "/" if no static prefix exists
 *
 * @example
 * ```typescript
 * getStaticPrefix("/users/:id/profile"); // "/users"
 * getStaticPrefix("/static/*"); // "/static"
 * getStaticPrefix("/:param/items"); // "/"
 * ```
 */
function getStaticPrefix(path: string): string {
	if (!path || path === "/") return "/";

	const segments = path.split("/").filter(Boolean);
	const staticSegments: string[] = [];

	for (const segment of segments) {
		if (segment.startsWith(":") || segment === "*") {
			break;
		}
		staticSegments.push(segment);
	}

	return staticSegments.length > 0 ? "/" + staticSegments.join("/") : "/";
}

/**
 * Creates a path matching function that checks if URL segments match a route pattern.
 * The matcher handles parameters (:) and wildcards (*) and extracts parameter values.
 *
 * @param segments - The route pattern segments to match against (e.g., ["users", ":id"])
 * @returns A function that takes URL segments and returns a match result with parameters
 *
 * @example
 * ```typescript
 * const matcher = createPathMatcherSegments(["users", ":id"]);
 * const result = matcher(["users", "123"]);
 * // Returns { matched: true, params: { id: "123" } }
 * ```
 */
function createPathMatcherSegments(segments: string[]): (urlSegments: string[]) => MatchResult {
	const segmentCount = segments.length;
	const hasWildcard = segments[segmentCount - 1] === "*";

	// Pre-calculate parameter positions and names for faster matching
	const paramPositions: Array<{ index: number; name: string }> = [];
	for (let i = 0; i < segmentCount; i++) {
		if (segments[i].startsWith(":")) {
			paramPositions.push({ index: i, name: segments[i].slice(1) });
		}
	}

	const hasParams = paramPositions.length > 0;

	return (urlSegments: string[]): MatchResult => {
		// Quick length check for non-wildcard routes
		if (!hasWildcard && urlSegments.length !== segmentCount) {
			return { matched: false, params: {} };
		}

		// Wildcard routes must have at least as many segments
		if (hasWildcard && urlSegments.length < segmentCount - 1) {
			return { matched: false, params: {} };
		}

		// Fast path for routes without parameters
		if (!hasParams && !hasWildcard) {
			for (let i = 0; i < segmentCount; i++) {
				if (segments[i] !== urlSegments[i]) {
					return { matched: false, params: {} };
				}
			}
			return { matched: true, params: {} };
		}

		// Match with parameter extraction
		const params: Record<string, string> = {};

		for (let i = 0; i < segmentCount; i++) {
			const seg = segments[i];
			const part = urlSegments[i];

			if (seg === "*") {
				params["*"] = urlSegments.slice(i).join("/");
				return { matched: true, params };
			}

			if (seg.startsWith(":")) {
				if (!part) return { matched: false, params: {} };
				params[seg.slice(1)] = decodeURIComponent(part);
			} else if (seg !== part) {
				return { matched: false, params: {} };
			}
		}

		const matched = urlSegments.length === segmentCount;
		return {
			matched,
			params: matched ? params : {},
		};
	};
}

/**
 * Joins multiple path segments into a single path, ensuring proper slashes between them.
 * Removes leading/trailing slashes from individual segments before joining.
 *
 * @param paths - Path segments to join (e.g., ["api", "v1", "users"])
 * @returns Joined path with single slashes (e.g., "/api/v1/users")
 *
 * @example
 * ```typescript
 * joinPaths("/api/", "/v1", "users/"); // "/api/v1/users"
 * joinPaths("", "users", ":id"); // "/users/:id"
 * ```
 */
function joinPaths(...paths: string[]) {
	let result = "/";
	for (let i = 0; i < paths.length; i++) {
		const p = paths[i];
		if (p && p !== "/") {
			// Trim slashes efficiently
			let start = 0;
			let end = p.length;
			if (p[0] === "/") start++;
			if (p[end - 1] === "/") end--;

			if (end > start) {
				if (result !== "/") result += "/";
				result += p.slice(start, end);
			}
		}
	}
	return result;
}

export type * from "./types";
