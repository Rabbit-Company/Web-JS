export type Middleware<T extends Record<string, unknown> = Record<string, unknown>> = (ctx: Context<T>, next: Next) => Response | Promise<Response | void>;
export type Next = () => Promise<Response | void>;

export interface TrieNode<T extends Record<string, unknown> = Record<string, unknown>> {
	children: Map<string, TrieNode<T>>; // static children keyed by segment name
	paramChild?: TrieNode<T>; // param child node (e.g. ":id")
	paramName?: string; // name of param (without ':')
	wildcardChild?: TrieNode<T>; // '*' wildcard child
	handlers?: Middleware<T>[]; // handlers at this node if route ends here
}

export type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS" | "HEAD";

export type MatchResult = {
	matched: boolean;
	params: Record<string, string>;
};

export type MiddlewareRoute<T extends Record<string, unknown> = Record<string, unknown>> = {
	method?: Method;
	path?: string;
	match: (url: string) => MatchResult;
	handler: Middleware<T>;
};

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

export interface Route<T extends Record<string, unknown> = Record<string, unknown>> {
	method: Method;
	path: string;
	match: (url: string) => { matched: boolean; params: Record<string, string> };
	handlers: Middleware<T>[];
}
