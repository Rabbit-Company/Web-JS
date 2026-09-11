import type { Context, Middleware } from "@rabbit-company/web";
// Re-exported for compatibility with earlier releases; prefer importing these from "@rabbit-company/web"
export type { Context, Middleware, Next } from "@rabbit-company/web";

/**
 * Options for configuring the Basic Authentication middleware.
 *
 * @template T - The shape of the context object.
 */
export interface BasicAuthOptions<T extends Record<string, unknown>, B extends Record<string, unknown>> {
	/**
	 * Function to validate the username and password.
	 *
	 * @param username - The provided username from the Authorization header.
	 * @param password - The provided password from the Authorization header.
	 * @param ctx - The request context object.
	 * @returns A boolean or Promise<boolean> indicating if the credentials are valid.
	 */
	validate: (username: string, password: string, ctx: Context<T, B>) => boolean | Promise<boolean>;

	/**
	 * The authentication realm presented to the user.
	 * Default: "Restricted"
	 */
	realm?: string;

	/**
	 * The key in the context where authenticated user information is stored.
	 * Default: "user"
	 */
	contextKey?: keyof T;

	/**
	 * Whether to skip basic authentication for specific routes.
	 * Function receives the context and returns true to skip the authentication.
	 */
	skip?: (ctx: Context<T, B>) => boolean | Promise<boolean>;
}

/**
 * Decodes base64 Basic credentials as UTF-8, which browsers and curl send,
 * falling back to Latin-1 for older clients whose bytes aren't valid UTF-8.
 *
 * @param encoded - The base64 part of the Authorization header
 * @returns The decoded "user-id:password" string
 * @throws When the value isn't valid base64
 */
function decodeCredentials(encoded: string): string {
	const binary = atob(encoded);
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return binary;
	}
}

/**
 * Basic Authentication middleware for HTTP Basic Auth.
 *
 * Adds a user object to the context on successful authentication.
 *
 * @template T - The context's data type.
 * @param {BasicAuthOptions<T, B>} options - Configuration options including validation function and realm.
 * @returns {Middleware<T, B>} - Middleware function for basic authentication.
 */
export function basicAuth<T extends Record<string, unknown> = Record<string, unknown>, B extends Record<string, unknown> = Record<string, unknown>>(
	options: BasicAuthOptions<T, B>,
): Middleware<T, B> {
	const { skip, validate, realm = "Restricted", contextKey = "user" as keyof T } = options;

	return async (ctx: Context<T, B>, next) => {
		// Check if we should skip this request
		if (skip && (await skip(ctx))) {
			return next();
		}

		const auth = ctx.req.headers.get("Authorization");

		if (!auth || !auth.startsWith("Basic ")) {
			ctx.header("WWW-Authenticate", `Basic realm="${realm}"`);
			return ctx.text("Unauthorized", 401);
		}

		try {
			const credentials = decodeCredentials(auth.slice(6));

			const separator = credentials.indexOf(":");
			if (separator === -1) {
				return ctx.text("Invalid credentials", 400);
			}

			const username = credentials.slice(0, separator);
			const password = credentials.slice(separator + 1);

			const isValid = await validate(username, password, ctx);

			if (!isValid) {
				ctx.header("WWW-Authenticate", `Basic realm="${realm}"`);
				return ctx.text("Unauthorized", 401);
			}

			ctx.set(contextKey, { username } as T[keyof T]);
			return next();
		} catch {
			return ctx.text("Invalid credentials", 400);
		}
	};
}
