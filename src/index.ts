import type { Context, MatchResult, Method, Middleware, MiddlewareRoute, Next, Route } from "./types";

class TrieNode<T extends Record<string, unknown> = Record<string, unknown>> {
	children = new Map<string, TrieNode<T>>();
	paramChild?: { node: TrieNode<T>; name: string };
	wildcardChild?: TrieNode<T>;
	handlers?: Middleware<T>[];
	method?: Method;

	constructor(public segment?: string) {}
}

// Pre-allocated objects for better performance
const EMPTY_PARAMS = Object.freeze({});
const EMPTY_SEARCH_PARAMS = new URLSearchParams();

export class Web<T extends Record<string, unknown> = Record<string, unknown>> {
	private routes: Route<T>[] = [];
	private middlewares: MiddlewareRoute<T>[] = [];
	private methodMiddlewareCache = new Map<Method, MiddlewareRoute<T>[]>();
	private urlCache = new Map<string, { pathname: string; searchParams?: URLSearchParams }>();
	private segmentCache = new Map<string, string[]>(); // Cache for path.split("/").filter(Boolean)

	private roots: Record<Method, TrieNode<T>> = {
		GET: new TrieNode(),
		POST: new TrieNode(),
		PUT: new TrieNode(),
		DELETE: new TrieNode(),
		PATCH: new TrieNode(),
		OPTIONS: new TrieNode(),
		HEAD: new TrieNode(),
	};

	constructor() {
		this.handle = this.handle.bind(this);
	}

	private clearCaches() {
		this.methodMiddlewareCache.clear();
		this.urlCache.clear();
		this.segmentCache.clear();
	}

	private errorHandler?: (err: Error, ctx: Context<T>) => Response | Promise<Response>;

	onError(handler: (err: Error, ctx: Context<T>) => Response | Promise<Response>): this {
		this.errorHandler = handler;
		return this;
	}

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

	route(prefix: string, subApp: this): this {
		for (const route of subApp.routes) {
			const newPath = joinPaths(prefix, route.path);
			this.addRoute(route.method, newPath, ...route.handlers);
		}
		return this;
	}

	get(path: string, ...handlers: Middleware<T>[]): this {
		this.addRoute("GET", path, ...handlers);
		return this;
	}

	post(path: string, ...handlers: Middleware<T>[]): this {
		this.addRoute("POST", path, ...handlers);
		return this;
	}

	put(path: string, ...handlers: Middleware<T>[]): this {
		this.addRoute("PUT", path, ...handlers);
		return this;
	}

	delete(path: string, ...handlers: Middleware<T>[]): this {
		this.addRoute("DELETE", path, ...handlers);
		return this;
	}

	patch(path: string, ...handlers: Middleware<T>[]): this {
		this.addRoute("PATCH", path, ...handlers);
		return this;
	}

	options(path: string, ...handlers: Middleware<T>[]): this {
		this.addRoute("OPTIONS", path, ...handlers);
		return this;
	}

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

	// Optimized context creation with object reuse patterns
	private createContext(req: Request, params: Record<string, string>, parsedUrl: { pathname: string; searchParams?: URLSearchParams }): Context<T> {
		const ctx: Context<T> = {
			req,
			params,
			state: {} as T,
			header: (name: string, value: string) => {},
			set: (key: keyof T, value: T[keyof T]) => {
				ctx.state[key] = value;
			},
			get: (key) => ctx.state[key],
			redirect: (url: string, status = 302) => {
				return new Response(null, {
					status,
					headers: { Location: url },
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
				const responseHeaders = new Headers({
					"Content-Type": "application/json",
					...headers,
				});
				return new Response(JSON.stringify(data), { status, headers: responseHeaders });
			},
			text: (data: string | null | undefined, status = 200, headers?: Record<string, string>) => {
				const responseHeaders = new Headers({
					"Content-Type": "text/plain",
					...headers,
				});
				return new Response(data, { status, headers: responseHeaders });
			},
			html: (html: string | null | undefined, status = 200, headers?: Record<string, string>) => {
				const responseHeaders = new Headers({
					"Content-Type": "text/html; charset=utf-8",
					...headers,
				});
				return new Response(html, { status, headers: responseHeaders });
			},
			query: () => parsedUrl.searchParams || EMPTY_SEARCH_PARAMS,
		};

		return ctx;
	}

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

function joinPaths(...paths: string[]) {
	return (
		"/" +
		paths
			.map((p) => p.replace(/^\/|\/$/g, ""))
			.filter(Boolean)
			.join("/")
	);
}
