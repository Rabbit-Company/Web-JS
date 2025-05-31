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
 * Interface representing a node in the trie data structure used for efficient route matching.
 * Each node can have static children, parameter children, or wildcard children.
 *
 * @template T - The type of the context state object
 *
 * @example
 * ```typescript
 * // Internal structure for route '/users/:id/posts'
 * // Root -> 'users' (static) -> ':id' (param) -> 'posts' (static)
 * ```
 */
export interface TrieNode<T extends Record<string, unknown> = Record<string, unknown>> {
	/** Map of static path segments to their corresponding child nodes */
	children: Map<string, TrieNode<T>>;
	/** Parameter child node for capturing dynamic segments (e.g., ':id') */
	paramChild?: TrieNode<T>;
	/** Name of the parameter without the ':' prefix */
	paramName?: string;
	/** Wildcard child node for matching remaining path segments ('*') */
	wildcardChild?: TrieNode<T>;
	/** Array of middleware handlers to execute when this node represents a complete route */
	handlers?: Middleware<T>[];
}

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
 * Result of attempting to match a URL path against a route pattern.
 *
 * @example
 * ```typescript
 * const result: MatchResult = {
 *   matched: true,
 *   params: { id: '123', category: 'electronics' }
 * };
 * ```
 */
export type MatchResult = {
	matched: boolean;
	params: Record<string, string>;
};

/**
 * Internal representation of middleware with matching logic.
 * Used to determine which middleware should run for a given request.
 *
 * @template T - The type of the context state object
 */
export type MiddlewareRoute<T extends Record<string, unknown> = Record<string, unknown>> = {
	/** Optional HTTP method this middleware applies to */
	method?: Method;
	/** Optional path pattern this middleware applies to */
	path?: string;
	/** Static prefix of the path for optimization */
	pathPrefix?: string;
	/** Function to determine if this middleware matches a given URL */
	match: (url: string) => MatchResult;
	/** The middleware handler function */
	handler: Middleware<T>;
};

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
	/** Client IP address, populated by web server or `ip-extract` middleware */
	clientIp?: string;
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
 * Internal representation of a route with its matching logic and handlers.
 *
 * @template T - The type of the context state object
 */
export interface Route<T extends Record<string, unknown> = Record<string, unknown>> {
	/** HTTP method for this route */
	method: Method;
	/** Path pattern for this route */
	path: string;
	/** Function to match URLs against this route pattern */
	match: (url: string) => { matched: boolean; params: Record<string, string> };
	/** Array of middleware handlers for this route */
	handlers: Middleware<T>[];
}
