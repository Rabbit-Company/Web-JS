/**
 * Middleware function type that processes requests and can return responses.
 * Middleware functions receive a context object and a next function to call the next middleware in the chain.
 *
 * @template T - The type of the context state object
 * @param ctx - Context object containing request data and helper methods
 * @param next - Function to call the next middleware in the chain
 * @returns Response object, Promise resolving to Response, or void to continue to next middleware
 *
 * @example
 * ```typescript
 * const authMiddleware: Middleware<{ user: User }> = async (ctx, next) => {
 *   const token = ctx.req.headers.get('authorization');
 *   if (!token) {
 *     return ctx.json({ error: 'Unauthorized' }, 401);
 *   }
 *
 *   const user = await verifyToken(token);
 *   ctx.set('user', user);
 *   await next(); // Continue to next middleware/handler
 * };
 * ```
 */
export type Middleware<T extends Record<string, unknown> = Record<string, unknown>> = (ctx: Context<T>, next: Next) => Response | Promise<Response | void>;
/**
 * Function type for calling the next middleware in the chain.
 * Returns a Promise that resolves to a Response or void.
 *
 * @returns Promise that resolves when the next middleware completes
 *
 * @example
 * ```typescript
 * const loggingMiddleware: Middleware = async (ctx, next) => {
 *   console.log(`${ctx.req.method} ${ctx.req.url} - Started`);
 *   const startTime = Date.now();
 *
 *   await next(); // Call next middleware
 *
 *   const duration = Date.now() - startTime;
 *   console.log(`${ctx.req.method} ${ctx.req.url} - Completed in ${duration}ms`);
 * };
 * ```
 */
export type Next = () => Promise<Response | void>;
/**
 * HTTP methods supported by the framework.
 *
 * @example
 * ```typescript
 * const method: Method = 'GET';
 * app.addRoute(method, '/users', handler);
 * ```
 */
export type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS" | "HEAD";
/**
 * Context object passed to middleware and route handlers containing request data and helper methods.
 * The context provides a convenient API for handling common web operations like parsing request bodies,
 * setting response headers, and managing application state.
 *
 * @template T - The type of the context state object for sharing data between middleware
 *
 * @example
 * ```typescript
 * interface AppState {
 *   user: User;
 *   requestId: string;
 * }
 *
 * const handler: Middleware<AppState> = async (ctx) => {
 *   // Access request data
 *   const userId = ctx.params.id;
 *   const query = ctx.query();
 *
 *   // Parse request body
 *   const body = await ctx.body<CreateUserRequest>();
 *
 *   // Set state
 *   ctx.set('requestId', generateId());
 *
 *   // Return response
 *   return ctx.json({ success: true });
 * };
 * ```
 */
export interface Context<T extends Record<string, unknown> = Record<string, unknown>> {
	/** The original Request object */
	req: Request;
	/** Optional Response object (for advanced use cases) */
	res?: Response;
	/** Object containing URL parameters extracted from the route path */
	params: Record<string, string>;
	/** Application state object for sharing data between middleware */
	state: T;
	/**
	 * Returns a plain text response.
	 *
	 * @param body - Text content for the response body
	 * @param status - HTTP status code (default: 200)
	 * @param headers - Additional headers to include
	 * @returns Response object with text content
	 *
	 * @example
	 * ```typescript
	 * return ctx.text('Hello World');
	 * return ctx.text('Not Found', 404);
	 * return ctx.text('Created', 201, { 'X-Custom': 'value' });
	 * ```
	 */
	text: (body: string | null | undefined, status?: number, headers?: Record<string, string>) => Response;
	/**
	 * Context method to send a JSON response with proper headers.
	 *
	 * @param data - Data to be serialized as JSON
	 * @param status - HTTP status code (default: 200)
	 * @param headers - Additional headers to include
	 * @returns {Response} Configured Response object
	 *
	 * @example
	 * ```typescript
	 * // Basic response
	 * return ctx.json({ message: 'Success' });
	 *
	 * // With status code
	 * return ctx.json({ error: 'Not found' }, 404);
	 *
	 * // With custom headers
	 * return ctx.json(
	 *   { data },
	 *   200,
	 *   { 'Cache-Control': 'max-age=3600' }
	 * );
	 *
	 * // With TypeScript type safety
	 * return ctx.json<ApiResponse<User>>({
	 *   status: 'success',
	 *   data: user
	 * });
	 * ```
	 */
	json: (data: unknown, status?: number, headers?: Record<string, string>) => Response;
	/**
	 * Returns an HTML response.
	 *
	 * @param html - HTML content for the response body
	 * @param status - HTTP status code (default: 200)
	 * @param headers - Additional headers to include
	 * @returns Response object with HTML content
	 *
	 * @example
	 * ```typescript
	 * return ctx.html('<h1>Welcome</h1>');
	 * return ctx.html('<h1>Error</h1>', 500);
	 * return ctx.html(template, 200, { 'X-Frame-Options': 'DENY' });
	 * ```
	 */
	html: (html: string | null | undefined, status?: number, headers?: Record<string, string>) => Response;
	/**
	 * Returns the URL search parameters as a URLSearchParams object.
	 *
	 * @returns URLSearchParams object for accessing query parameters
	 *
	 * @example
	 * ```typescript
	 * // For URL: /users?page=2&limit=10
	 * const query = ctx.query();
	 * const page = query.get('page'); // '2'
	 * const limit = query.get('limit'); // '10'
	 * ```
	 */
	query: () => URLSearchParams;
	/**
	 * Context method to parse and return the request body as JSON.
	 * Automatically handles content-type detection and parsing.
	 *
	 * @template U - Type of the expected response body
	 * @returns {Promise<U>} Parsed request body
	 *
	 * @example
	 * ```typescript
	 * // Basic usage
	 * const user = await ctx.body<User>();
	 *
	 * // With error handling
	 * try {
	 *   const data = await ctx.body<CreateUserRequest>();
	 * } catch (err) {
	 *   return ctx.json({ error: 'Invalid JSON' }, 400);
	 * }
	 *
	 * // With validation
	 * const raw = await ctx.body<unknown>();
	 * const valid = userSchema.parse(raw);
	 * ```
	 */
	body: <T>() => Promise<T>;
	/**
	 * Sets a response header.
	 *
	 * @param name - Header name
	 * @param value - Header value
	 *
	 * @example
	 * ```typescript
	 * ctx.header('X-Custom-Header', 'value');
	 * ```
	 */
	header: (name: string, value: string) => void;
	/**
	 * Sets a value in the context state.
	 *
	 * @template K - Key type from the state object
	 * @param key - The state key to set
	 * @param value - The value to set
	 *
	 * @example
	 * ```typescript
	 * ctx.set('user', currentUser);
	 * ctx.set('requestId', uuid());
	 * ```
	 */
	set: <K extends keyof T>(key: K, value: T[K]) => void;
	/**
	 * Gets a value from the context state.
	 *
	 * @template K - Key type from the state object
	 * @param key - The state key to retrieve
	 * @returns The value associated with the key
	 *
	 * @example
	 * ```typescript
	 * const user = ctx.get('user');
	 * const requestId = ctx.get('requestId');
	 * ```
	 */
	get: <K extends keyof T>(key: K) => T[K];
	/**
	 * Returns a redirect response.
	 *
	 * @param url - URL to redirect to
	 * @param status - HTTP status code for redirect (default: 302)
	 * @returns Response object with redirect headers
	 *
	 * @example
	 * ```typescript
	 * return ctx.redirect('/login');
	 * return ctx.redirect('https://example.com', 301);
	 * ```
	 */
	redirect: (url: string, status?: number) => Response;
}
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
export declare class Web<T extends Record<string, unknown> = Record<string, unknown>> {
	/** Array of all registered routes */
	private routes;
	/** Array of all registered middleware */
	private middlewares;
	/** Cache for method-specific middleware to avoid filtering on each request */
	private methodMiddlewareCache;
	/** Cache for parsed URLs to avoid repeated parsing */
	private urlCache;
	/** Cache for path segments to avoid repeated splitting */
	private segmentCache;
	/** Trie roots for each HTTP method for fast route matching */
	private roots;
	/**
	 * Creates a new Web framework instance
	 */
	constructor();
	/**
	 * Clears all internal caches. Called automatically when routes or middleware are modified.
	 * @private
	 */
	private clearCaches;
	/** Error handler function for handling uncaught errors */
	private errorHandler?;
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
	onError(handler: (err: Error, ctx: Context<T>) => Response | Promise<Response>): this;
	/**
	 * Splits a path into segments and caches the result for performance.
	 *
	 * @param path - The URL path to split
	 * @returns Array of path segments (empty segments filtered out)
	 * @private
	 */
	private getPathSegments;
	/**
	 * Parses a URL into pathname and search parameters with caching for performance.
	 * Handles both absolute and relative URLs.
	 *
	 * @param url - The URL to parse
	 * @returns Object containing pathname and optional URLSearchParams
	 * @private
	 */
	private parseUrl;
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
	use(...args: [
		Middleware<T>
	] | [
		string,
		Middleware<T>
	] | [
		Method,
		string,
		Middleware<T>
	]): this;
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
	addRoute(method: Method, path: string, ...handlers: Middleware<T>[]): void;
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
	match(method: Method, path: string): {
		handlers?: Middleware<T>[];
		params: Record<string, string>;
	} | null;
	/**
	 * Gets cached middleware that applies to a specific HTTP method.
	 *
	 * @param method - HTTP method to filter middleware for
	 * @returns Array of middleware routes that apply to the method
	 * @private
	 */
	private getMethodMiddlewares;
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
	scope(path: string, callback: (scopeApp: this) => void): this;
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
	route(prefix: string, subApp: this): this;
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
	get(path: string, ...handlers: Middleware<T>[]): this;
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
	post(path: string, ...handlers: Middleware<T>[]): this;
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
	put(path: string, ...handlers: Middleware<T>[]): this;
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
	delete(path: string, ...handlers: Middleware<T>[]): this;
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
	patch(path: string, ...handlers: Middleware<T>[]): this;
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
	options(path: string, ...handlers: Middleware<T>[]): this;
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
	head(path: string, ...handlers: Middleware<T>[]): this;
	/**
	 * Creates a context object for the current request with helper methods.
	 *
	 * @param req - The incoming Request object
	 * @param params - URL parameters extracted from the path
	 * @param parsedUrl - Pre-parsed URL components
	 * @returns Context object with request data and helper methods
	 * @private
	 */
	private createContext;
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
	handle(req: Request): Promise<Response>;
}

export {};
