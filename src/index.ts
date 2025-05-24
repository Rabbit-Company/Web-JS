import type { Context, Method, Middleware, MiddlewareRoute, Route } from "./types";

class TrieNode<T extends Record<string, unknown> = Record<string, unknown>> {
	children = new Map<string, TrieNode<T>>();
	paramChild?: TrieNode<T>;
	paramName?: string;
	wildcardChild?: TrieNode<T>;
	handlers?: Middleware<T>[];
	method?: Method;

	constructor(public segment?: string) {}
}

export class Web<T extends Record<string, unknown> = Record<string, unknown>> {
	private routes: Route<T>[] = [];
	private middlewares: MiddlewareRoute<T>[] = [];

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

	use(...args: [Middleware<T>] | [string, Middleware<T>] | [Method, string, Middleware<T>]): this {
		if (args.length === 1) {
			// global middleware
			const [handler] = args;
			this.middlewares.push({
				match: () => ({ matched: true, params: {} }),
				handler,
			});
		} else if (args.length === 2) {
			// path-specific middleware
			const [path, handler] = args;
			const segments = path.split("/").filter(Boolean);
			const match = createPathMatcherSegments(segments);
			this.middlewares.push({
				path,
				match: (url) => match(url.split("/").filter(Boolean)),
				handler,
			});
		} else {
			// method + path middleware
			const [method, path, handler] = args;
			const segments = path.split("/").filter(Boolean);
			const match = createPathMatcherSegments(segments);
			this.middlewares.push({
				method,
				path,
				match: (url) => match(url.split("/").filter(Boolean)),
				handler,
			});
		}
		return this;
	}

	addRoute(method: Method, path: string, ...handlers: Middleware<T>[]) {
		const segments = path.split("/").filter(Boolean);
		let node = this.roots[method];

		for (const segment of segments) {
			if (segment === "*") {
				if (!node.wildcardChild) {
					node.wildcardChild = new TrieNode("*");
				}
				node = node.wildcardChild;
				break; // wildcard is always last
			} else if (segment.startsWith(":")) {
				if (!node.paramChild) {
					node.paramChild = new TrieNode(segment);
					node.paramChild.paramName = segment.slice(1);
				}
				node = node.paramChild;
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
		this.routes.push({ method, path, handlers, match: (url) => matcher(url.split("/").filter(Boolean)) });
	}

	match(method: Method, path: string): { handlers?: Middleware<T>[]; params: Record<string, string> } | null {
		const segments = path.split("/").filter(Boolean);
		const params: Record<string, string> = {};

		function search(node: TrieNode<T>, i: number): TrieNode<T> | null {
			if (i === segments.length) {
				if (node.handlers) return node;
				if (node.wildcardChild && node.wildcardChild.handlers) return node.wildcardChild;
				return null;
			}

			const segment = segments[i];
			if (!segment) return null;

			// Try static child first
			if (node.children.has(segment)) {
				const found = search(node.children.get(segment)!, i + 1);
				if (found) return found;
			}

			// Try param child
			if (node.paramChild) {
				params[node.paramChild.paramName!] = decodeURIComponent(segment);
				const found = search(node.paramChild, i + 1);
				if (found) return found;
				delete params[node.paramChild.paramName!]; // backtrack param
			}

			// Try wildcard child
			if (node.wildcardChild && node.wildcardChild.handlers) {
				return node.wildcardChild;
			}

			return null;
		}

		const root = this.roots[method];
		const matchedNode = search(root, 0);

		if (!matchedNode) return null;

		return { handlers: matchedNode.handlers, params };
	}

	scope(path: string, callback: (scopeApp: this) => void): this {
		const scopedApp = new (this.constructor as any)() as this;
		callback(scopedApp);

		const baseSegments = path.split("/").filter(Boolean);

		for (const mw of scopedApp.middlewares) {
			const originalMatch = mw.match;
			const prefixedMatch = (url: string) => {
				const urlSegments = url.split("/").filter(Boolean);

				if (urlSegments.length < baseSegments.length) {
					return { matched: false };
				}

				for (let i = 0; i < baseSegments.length; i++) {
					if (baseSegments[i] !== urlSegments[i]) {
						return { matched: false };
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

	async handle(req: Request): Promise<Response> {
		const url = new URL(req.url);
		const method = req.method as Method;

		const matched = this.match(method, url.pathname);
		if (!matched) {
			return new Response("Not Found", { status: 404 });
		}

		const { handlers, params } = matched;

		const middlewares: Middleware<T>[] = this.middlewares
			.filter((mw) => (!mw.method || mw.method === method) && mw.match(url.pathname).matched)
			.map((mw) => mw.handler);

		const ctx: Context<T> = {
			req,
			params,
			state: {} as T,
			async body<U>(): Promise<U> {
				const type = req.headers.get("content-type") ?? "";
				if (type.includes("application/json")) {
					return req.json() as Promise<U>;
				}
				return {} as U;
			},
			json(data: unknown, status = 200): Response {
				return new Response(JSON.stringify(data), {
					status,
					headers: { "Content-Type": "application/json" },
				});
			},
			text(data: string | null | undefined, status = 200): Response {
				return new Response(data, {
					status,
					headers: { "Content-Type": "text/plain" },
				});
			},
			html(html: string | null | undefined, status = 200): Response {
				return new Response(html, {
					status,
					headers: { "Content-Type": "text/html; charset=utf-8" },
				});
			},
			query(): URLSearchParams {
				return new URL(req.url).searchParams;
			},
		};

		try {
			const stack: Middleware<T>[] = [...middlewares, ...(handlers ?? [])];

			let i = -1;
			let response: Response | null = null;

			const runner = async (): Promise<void> => {
				i++;
				const fn = stack[i];
				if (!fn) return;

				const result = await Promise.resolve(
					fn(ctx, async () => {
						if (response) return;
						await runner();
					})
				);

				if (result instanceof Response && !response) {
					response = result;
				}
			};

			await runner();

			if (response) return response;

			return new Response("No response returned by handler", { status: 500 });
		} catch (err) {
			return new Response("Internal Server Error", { status: 500 });
		}
	}
}

function createPathMatcherSegments(segments: string[]): (urlSegments: string[]) => { matched: boolean; params: Record<string, string> } {
	return (urlSegments: string[]) => {
		if (urlSegments.length < segments.length) return { matched: false, params: {} };

		const params: Record<string, string> = {};

		for (let i = 0; i < segments.length; i++) {
			const seg = segments[i];
			const part = urlSegments[i];
			if (seg === "*") return { matched: true, params };
			if (seg?.startsWith(":")) {
				if (!part) return { matched: false, params: {} };
				params[seg.slice(1)] = decodeURIComponent(part);
			} else if (seg !== part) {
				return { matched: false, params: {} };
			}
		}

		const matched = urlSegments.length === segments.length;
		return { matched, params: matched ? params : {} };
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
