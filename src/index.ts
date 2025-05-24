import type { Context, Method, Middleware, MiddlewareRoute, Route } from "./types";

export class Web<T extends Record<string, unknown> = Record<string, unknown>> {
	private routes: Route<T>[] = [];
	private middlewares: MiddlewareRoute<T>[] = [];

	constructor() {
		this.handle = this.handle.bind(this);
	}

	use(...args: [Middleware<T>] | [string, Middleware<T>] | [Method, string, Middleware<T>]): this {
		if (args.length === 1) {
			// global middleware
			const [handler] = args;
			this.middlewares.push({
				match: () => ({ matched: true }),
				handler,
			});
		} else if (args.length === 2) {
			// path-specific middleware
			const [path, handler] = args;
			const match = createPathMatcher(path);
			this.middlewares.push({
				path,
				match: (url: string) => match(url),
				handler,
			});
		} else {
			// method + path middleware
			const [method, path, handler] = args;
			const match = createPathMatcher(path);
			this.middlewares.push({
				method,
				path,
				match: (url: string) => match(url),
				handler,
			});
		}
		return this;
	}

	private addRoute(method: Method, path: string, ...handlers: Middleware<T>[]): void {
		const match = createPathMatcher(path);
		this.routes.push({
			method,
			path,
			match,
			handlers,
		});
	}

	scope(prefix: string, fn: (app: Web<T>) => void): this {
		const subApp = new Web<T>();
		fn(subApp);

		for (const mw of subApp.middlewares) {
			const newPath = mw.path ? `${prefix}${mw.path}`.replace(/\/+/g, "/") : `${prefix.replace(/\/+$/, "")}/*`;

			this.middlewares.push({
				...mw,
				path: newPath,
				match: createPathMatcher(newPath),
			});
		}

		this.route(prefix, subApp);
		return this;
	}

	route(prefix: string, subApp: Web<T>): this {
		for (const route of subApp.routes) {
			const newPath = `${prefix}${route.path}`.replace(/\/+/g, "/");
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

		for (const route of this.routes) {
			if (route.method === method) {
				const match = route.match(url.pathname);
				if (match.matched) {
					const ctx: Context<T> = {
						req,
						params: match.params,
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
						const middlewares: Middleware<T>[] = this.middlewares
							.filter((mw) => (!mw.method || mw.method === method) && mw.match(url.pathname).matched)
							.map((mw) => mw.handler);

						const handlers: Middleware<T>[] = route.handlers;

						const stack: Middleware<T>[] = [...middlewares, ...handlers];

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
		}

		return new Response("Not Found", { status: 404 });
	}
}

function createPathMatcher(path: string): (url: string) => { matched: boolean; params: Record<string, string> } {
	const segments: string[] = path.split("/").filter(Boolean);

	return (url: string) => {
		const parts: string[] = url.split("/").filter(Boolean);
		const params: Record<string, string> = {};

		for (let i = 0; i < segments.length; i++) {
			const seg = segments[i];
			const part = parts[i];
			if (seg === "*") return { matched: true, params };
			if (seg?.startsWith(":")) {
				if (!part) return { matched: false, params: {} };
				params[seg.slice(1)] = decodeURIComponent(part);
			} else if (seg !== part) {
				return { matched: false, params: {} };
			}
		}

		const matched = parts.length === segments.length;
		return { matched, params: matched ? params : {} };
	};
}
