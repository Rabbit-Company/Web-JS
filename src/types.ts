export type Handler<T extends Record<string, unknown> = Record<string, unknown>> = (ctx: Context<T>) => Response | Promise<Response> | undefined;
export type Middleware<T extends Record<string, unknown> = Record<string, unknown>> = Handler<T>;

export type Method = "GET" | "POST" | "PUT" | "DELETE";

export interface Context<T extends Record<string, unknown> = Record<string, unknown>> {
	req: Request;
	res?: Response;
	params: Record<string, string>;
	state: T;
	text: (body: string | null | undefined, status?: number) => Response;
	json: (data: unknown, status?: number) => Response;
	html: (html: string | null | undefined, status?: number) => Response;
	query: () => URLSearchParams;
	body: <T>() => Promise<T>;
}

export interface Route<T extends Record<string, unknown> = Record<string, unknown>> {
	method: Method;
	path: string;
	match: (url: string) => { matched: boolean; params: Record<string, string> };
	handlers: Middleware<T>[];
}
