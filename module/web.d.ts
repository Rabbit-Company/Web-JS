export type Middleware<T extends Record<string, unknown> = Record<string, unknown>> = (ctx: Context<T>, next: Next) => Response | Promise<Response | void>;
export type Next = () => Promise<Response | void>;
export type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS" | "HEAD";
export interface Context<T extends Record<string, unknown> = Record<string, unknown>> {
	req: Request;
	res?: Response;
	params: Record<string, string>;
	state: T;
	text: (body: string | null | undefined, status?: number, headers?: Record<string, string>) => Response;
	json: (data: unknown, status?: number, headers?: Record<string, string>) => Response;
	html: (html: string | null | undefined, status?: number, headers?: Record<string, string>) => Response;
	query: () => URLSearchParams;
	body: <T>() => Promise<T>;
	header: (name: string, value: string) => void;
	set: <K extends keyof T>(key: K, value: T[K]) => void;
	get: <K extends keyof T>(key: K) => T[K];
	redirect: (url: string, status?: number) => Response;
}
export declare class Web<T extends Record<string, unknown> = Record<string, unknown>> {
	private routes;
	private middlewares;
	private methodMiddlewareCache;
	private roots;
	constructor();
	private clearMethodCache;
	private errorHandler?;
	onError(handler: (err: Error, ctx: Context<T>) => Response | Promise<Response>): this;
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
	addRoute(method: Method, path: string, ...handlers: Middleware<T>[]): void;
	match(method: Method, path: string): {
		handlers?: Middleware<T>[];
		params: Record<string, string>;
	} | null;
	private getMethodMiddlewares;
	scope(path: string, callback: (scopeApp: this) => void): this;
	route(prefix: string, subApp: this): this;
	get(path: string, ...handlers: Middleware<T>[]): this;
	post(path: string, ...handlers: Middleware<T>[]): this;
	put(path: string, ...handlers: Middleware<T>[]): this;
	delete(path: string, ...handlers: Middleware<T>[]): this;
	patch(path: string, ...handlers: Middleware<T>[]): this;
	options(path: string, ...handlers: Middleware<T>[]): this;
	head(path: string, ...handlers: Middleware<T>[]): this;
	handle(req: Request): Promise<Response>;
}

export {};
