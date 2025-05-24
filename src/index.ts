import type { Context, Method, Middleware, Route } from "./types";

export class Web<T extends Record<string, unknown> = Record<string, unknown>> {
	private routes: Route<T>[] = [];
	private middlewares: Middleware<T>[] = [];

	constructor() {
		this.handle = this.handle.bind(this);
	}

	use(mw: Middleware<T>): this {
		this.middlewares.push(mw);
		return this;
	}

	private addRoute(method: Method, path: string, ...handlers: Middleware<T>[]) {
		const match = createPathMatcher(path);
		this.routes.push({
			method,
			path,
			match,
			handlers: [...this.middlewares, ...handlers],
		});
	}

	scope<U extends Record<string, unknown>>(prefix: string, fn: (app: Web<U>) => void): this {
		const subApp = new Web<U>();
		fn(subApp);
		this.route(prefix, subApp);
		return this;
	}

	route(prefix: string, subApp: Web<any>) {
		for (const route of subApp.routes) {
			const newPath = `${prefix}${route.path}`.replace(/\/+/g, "/");
			this.addRoute(route.method, newPath, ...(route.handlers as Middleware<T>[]));
		}
		return this;
	}

	get(path: string, ...handlers: Middleware<T>[]) {
		this.addRoute("GET", path, ...handlers);
		return this;
	}

	post(path: string, ...handlers: Middleware<T>[]) {
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
						async body<T>() {
							const type = req.headers.get("content-type") || "";
							if (type.includes("application/json")) {
								return req.json() as Promise<T>;
							}
							return {} as T;
						},
						json: (data, status = 200) =>
							new Response(JSON.stringify(data), {
								status,
								headers: { "Content-Type": "application/json" },
							}),
						text: (data, status = 200) =>
							new Response(data, {
								status,
								headers: { "Content-Type": "text/plain" },
							}),
						html(html: string | null | undefined, status = 200) {
							return new Response(html, {
								status,
								headers: { "Content-Type": "text/html; charset=utf-8" },
							});
						},
						query() {
							return new URL(req.url).searchParams;
						},
					};

					for (const handler of route.handlers) {
						try {
							const res = await handler(ctx);
							if (res) return res;
						} catch (err) {
							return new Response("Internal Server Error", { status: 500 });
						}
					}

					return new Response("No response returned by handler", {
						status: 500,
					});
				}
			}
		}

		return new Response("Not Found", { status: 404 });
	}
}

function createPathMatcher(path: string) {
	const segments = path.split("/").filter(Boolean);
	return (url: string) => {
		const parts = url.split("/").filter(Boolean);
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

		return parts.length === segments.length ? { matched: true, params } : { matched: false, params: {} };
	};
}
