import type { Context, MatchResult, Method, Middleware, MiddlewareRoute, Next, Route } from "./types";

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
	private routes: Route<T>[] = [];
	/** Array of all registered middleware */
	private middlewares: MiddlewareRoute<T>[] = [];
	/** Cache for method-specific middleware to avoid filtering on each request */
	private methodMiddlewareCache = new Map<Method, MiddlewareRoute<T>[]>();
	/** Cache for parsed URLs to avoid repeated parsing */
	private urlCache = new Map<string, { pathname: string; searchParams?: URLSearchParams }>();
	/** Cache for path segments to avoid repeated splitting */
	private segmentCache = new Map<string, string[]>();

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
	}

	/**
	 * Clears all internal caches. Called automatically when routes or middleware are modified.
	 * @private
	 */
	private clearCaches() {
		this.methodMiddlewareCache.clear();
		this.urlCache.clear();
		this.segmentCache.clear();
	}

	/** Error handler function for handling uncaught errors */
	private errorHandler?: (err: Error, ctx: Context<T>) => Response | Promise<Response>;

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
	 * Splits a path into segments and caches the result for performance.
	 *
	 * @param path - The URL path to split
	 * @returns Array of path segments (empty segments filtered out)
	 * @private
	 */
	private getPathSegments(path: string): string[] {
		if (this.segmentCache.has(path)) {
			return this.segmentCache.get(path)!;
		}

		const segments = path.split("/").filter(Boolean);

		// Cache with size limit
		if (this.segmentCache.size < 500) {
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
		if (this.urlCache.has(url)) {
			return this.urlCache.get(url)!;
		}

		const queryStart = url.indexOf("?");
		const hashStart = url.indexOf("#");

		// Find where pathname ends
		let end = url.length;
		if (queryStart !== -1) end = Math.min(end, queryStart);
		if (hashStart !== -1) end = Math.min(end, hashStart);

		// Extract pathname
		const protocolEnd = url.indexOf("://");
		let pathname: string;

		if (protocolEnd === -1) {
			// Relative URL
			pathname = url.substring(0, end);
		} else {
			const hostStart = protocolEnd + 3;
			const pathStart = url.indexOf("/", hostStart);
			pathname = pathStart === -1 ? "/" : url.substring(pathStart, end);
		}

		// Only parse search params if there's a query string
		let searchParams: URLSearchParams | undefined;
		if (queryStart !== -1) {
			const searchString = hashStart === -1 ? url.substring(queryStart + 1) : url.substring(queryStart + 1, hashStart);
			searchParams = new URLSearchParams(searchString);
		}

		const result = { pathname, searchParams };

		// Cache result (with size limit to prevent memory leaks)
		if (this.urlCache.size < 1000) {
			this.urlCache.set(url, result);
		}

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
		this.clearCaches();

		if (args.length === 1) {
			const [handler] = args;
			this.middlewares.push({
				match: () => ({ matched: true, params: {} }),
				handler,
			});
		} else if (args.length === 2) {
			const [path, handler] = args;
			const segments = this.getPathSegments(path);
			const match = createPathMatcherSegments(segments);
			this.middlewares.push({
				path,
				pathPrefix: getStaticPrefix(path),
				match: (url) => match(this.getPathSegments(url)),
				handler,
			});
		} else {
			const [method, path, handler] = args;
			const segments = this.getPathSegments(path);
			const match = createPathMatcherSegments(segments);
			this.middlewares.push({
				method,
				path,
				pathPrefix: getStaticPrefix(path),
				match: (url) => match(this.getPathSegments(url)),
				handler,
			});
		}
		return this;
	}

	/**
	 * Adds a route with the specified method, path, and handlers to the trie structure.
	 *
	 * @param method - HTTP method (GET, POST, etc.)
	 * @param path - URL path pattern (supports :param and * wildcards)
	 * @param handlers - One or more middleware handlers for this route
	 *
	 * @example
	 * ```typescript
	 * app.addRoute('GET', '/users/:id', async (ctx) => {
	 *   return ctx.json({ id: ctx.params.id });
	 * });
	 * ```
	 */
	addRoute(method: Method, path: string, ...handlers: Middleware<T>[]) {
		this.clearCaches();

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

		const matcher = createPathMatcherSegments(segments);
		this.routes.push({
			method,
			path,
			handlers,
			match: (url) => matcher(this.getPathSegments(url)),
		});
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
		const root = this.roots[method];
		if (!root) return null;

		const segments = this.getPathSegments(path);
		if (segments.length === 0) {
			// Root path "/"
			return root.handlers ? { handlers: root.handlers, params: EMPTY_PARAMS } : null;
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

			return null;
		}

		// Check if we've consumed all segments or hit a wildcard
		if (i === segments.length || node.segment === "*") {
			if (node.handlers) {
				return Object.keys(params).length === 0 ? { handlers: node.handlers, params: EMPTY_PARAMS } : { handlers: node.handlers, params };
			}
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

		const baseSegments = this.getPathSegments(path);

		for (const mw of scopedApp.middlewares) {
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
				match: prefixedMatch,
				path: path + (mw.path ?? ""),
				pathPrefix: getStaticPrefix(path + (mw.path ?? "")),
			});
		}

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
	private createContext(req: Request, params: Record<string, string>, parsedUrl: { pathname: string; searchParams?: URLSearchParams }): Context<T> {
		// Initialize response headers storage
		const responseHeaders = new Headers();

		const ctx: Context<T> = {
			req,
			params,
			state: {} as T,
			header: (name: string, value: string) => {
				responseHeaders.set(name, value);
			},
			set: (key: keyof T, value: T[keyof T]) => {
				ctx.state[key] = value;
			},
			get: (key) => ctx.state[key],
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
				const allHeaders = new Headers(responseHeaders);
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
				const allHeaders = new Headers(responseHeaders);
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
				const allHeaders = new Headers(responseHeaders);
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
				return new Response("Not Found", { status: 404 });
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

				for (const handler of matched.handlers || []) {
					const result = await handler(ctx, async () => {});
					if (result instanceof Response) {
						return result;
					}
				}

				return new Response("No response returned by handler", { status: 500 });
			}

			// Full path with middleware processing
			const methodMiddlewares = this.getMethodMiddlewares(method);
			const middlewares: Middleware<T>[] = [];
			let finalParams = matched.params;

			// Only process middlewares if there are any
			if (methodMiddlewares.length > 0) {
				// Pre-filter middlewares by path prefix before expensive matching
				for (const mw of methodMiddlewares) {
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
						middlewares.push(mw.handler);
					}
				}
			}

			// Create context once
			const ctx = this.createContext(req, finalParams, parsedUrl);

			// Execute middleware and handlers
			const stack = [...middlewares, ...(matched.handlers ?? [])];

			for (const fn of stack) {
				const result = await fn(ctx, async () => {});
				if (result instanceof Response) {
					return result;
				}
			}

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
							headers: { "Content-Type": "application/json" },
						}),
					html: (html, status = 500) =>
						new Response(html, {
							status,
							headers: { "Content-Type": "text/html" },
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

	return (urlSegments: string[]): MatchResult => {
		if (urlSegments.length < segmentCount) return { matched: false, params: {} };

		const params: Record<string, string> = {};
		let hasParams = false;

		for (let i = 0; i < segmentCount; i++) {
			const seg = segments[i];
			const part = urlSegments[i];

			if (seg === "*") return { matched: true, params: hasParams ? params : {} };

			if (seg?.startsWith(":")) {
				if (!part) return { matched: false, params: {} };
				params[seg.slice(1)] = decodeURIComponent(part);
				hasParams = true;
			} else if (seg !== part) {
				return { matched: false, params: {} };
			}
		}

		const matched = urlSegments.length === segmentCount;
		return {
			matched,
			params: matched ? (hasParams ? params : {}) : {},
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
	return (
		"/" +
		paths
			.map((p) => p.replace(/^\/|\/$/g, ""))
			.filter(Boolean)
			.join("/")
	);
}
