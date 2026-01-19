import type { Context, Middleware } from "@rabbit-company/web";

/**
 * Options to configure the CORS middleware behavior.
 */
export interface CorsOptions {
	/**
	 * The origin(s) allowed to access the resource.
	 * Can be a string, array of strings, or a function returning a boolean or Promise<boolean>.
	 */
	origin?: string | string[] | ((origin: string) => boolean | Promise<boolean>);

	/**
	 * Allowed HTTP methods for CORS requests.
	 * Default: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"]
	 */
	allowMethods?: string[];

	/**
	 * Allowed headers for CORS requests.
	 * Default: ["Content-Type", "Authorization"]
	 */
	allowHeaders?: string[];

	/**
	 * Headers that are safe to expose to the API of a CORS API specification.
	 */
	exposeHeaders?: string[];

	/**
	 * Whether to include credentials (cookies, authorization headers, TLS client certificates).
	 * Default: false
	 */
	credentials?: boolean;

	/**
	 * How long the results of a preflight request can be cached (in seconds).
	 * Default: 86400
	 */
	maxAge?: number;

	/**
	 * Whether the middleware should pass control to the next handler after preflight.
	 * Default: false
	 */
	preflightContinue?: boolean;

	/**
	 * The HTTP status code sent for successful OPTIONS requests.
	 * Default: 204
	 */
	optionsSuccessStatus?: number;
}

const defaults: CorsOptions = {
	origin: "*",
	allowMethods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
	allowHeaders: ["Content-Type", "Authorization"],
	credentials: false,
	maxAge: 86400,
	optionsSuccessStatus: 204,
};

/**
 * CORS middleware to handle Cross-Origin Resource Sharing requests.
 *
 * @template T - The context's data type.
 * @param {CorsOptions} [options={}] - Configuration options for CORS behavior.
 * @returns {Middleware<T, B>} - A middleware function for handling CORS headers.
 */
export function cors<T extends Record<string, unknown> = Record<string, unknown>, B extends Record<string, unknown> = Record<string, unknown>>(
	options: CorsOptions = {},
): Middleware<T, B> {
	const opts = { ...defaults, ...options };

	return async (ctx: Context<T, B>, next) => {
		const requestOrigin = ctx.req.headers.get("Origin");

		// Non-CORS request
		if (!requestOrigin) {
			return next();
		}

		const isAllowed = await checkOrigin(requestOrigin, opts.origin);

		if (isAllowed) {
			const isWildcard = opts.origin === "*" && !opts.credentials;

			if (isWildcard) {
				ctx.header("Access-Control-Allow-Origin", "*");
			} else {
				ctx.header("Access-Control-Allow-Origin", requestOrigin);
				appendVary(ctx, "Origin");
			}

			if (opts.credentials) {
				ctx.header("Access-Control-Allow-Credentials", "true");
			}

			if (opts.exposeHeaders?.length) {
				ctx.header("Access-Control-Expose-Headers", opts.exposeHeaders.join(", "));
			}
		}

		// Preflight request
		if (ctx.req.method === "OPTIONS") {
			if (opts.allowMethods?.length) {
				ctx.header("Access-Control-Allow-Methods", opts.allowMethods.join(", "));
			}

			if (opts.allowHeaders?.length) {
				ctx.header("Access-Control-Allow-Headers", opts.allowHeaders.join(", "));
			}

			if (opts.maxAge !== undefined) {
				ctx.header("Access-Control-Max-Age", String(opts.maxAge));
			}

			if (!opts.preflightContinue) {
				return ctx.text("", opts.optionsSuccessStatus ?? 204);
			}
		}

		return next();
	};
}

/**
 * Validates if the request origin is allowed based on the provided CORS origin config.
 *
 * @param {string} origin - The incoming request's origin.
 * @param {CorsOptions['origin']} allowed - The allowed origin(s) or validation function.
 * @returns {Promise<boolean>} - Resolves to true if the origin is allowed, otherwise false.
 */
async function checkOrigin(origin: string, allowed?: string | string[] | ((origin: string) => boolean | Promise<boolean>)): Promise<boolean> {
	if (!allowed || allowed === "*") return true;
	if (typeof allowed === "string") return origin === allowed;
	if (Array.isArray(allowed)) return allowed.includes(origin);
	if (typeof allowed === "function") return await allowed(origin);
	return false;
}

function appendVary(ctx: Context<any, any>, value: string) {
	const existing = ctx.res?.headers.get("Vary");
	if (!existing) {
		ctx.header("Vary", value);
	} else if (
		!existing
			.split(",")
			.map((v) => v.trim())
			.includes(value)
	) {
		ctx.header("Vary", `${existing}, ${value}`);
	}
}
