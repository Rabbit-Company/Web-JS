import type { Context, Middleware } from "@rabbit-company/web";

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
 * Basic Authentication middleware for HTTP Basic Auth.
 *
 * Adds a user object to the context on successful authentication.
 *
 * @template T - The context's data type.
 * @param {BasicAuthOptions<T, B>} options - Configuration options including validation function and realm.
 * @returns {Middleware<T, B>} - Middleware function for basic authentication.
 */
export function basicAuth<T extends Record<string, unknown> = Record<string, unknown>, B extends Record<string, unknown> = Record<string, unknown>>(
	options: BasicAuthOptions<T, B>
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
			const credentials = atob(auth.slice(6));
			const [username, password] = credentials.split(":");

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
