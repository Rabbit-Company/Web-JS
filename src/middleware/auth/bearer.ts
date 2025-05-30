import type { Middleware, Context } from "../../types";

/**
 * Options for configuring the Bearer Token Authentication middleware.
 *
 * @template T - The shape of the context object.
 */
export interface BearerAuthOptions<T extends Record<string, unknown>> {
	/**
	 * Function to validate the bearer token.
	 *
	 * @param token - The bearer token from the Authorization header.
	 * @param ctx - The request context object.
	 * @returns A boolean, user object, or Promise resolving to either.
	 *          - `false`: Token is invalid
	 *          - `true`: Token is valid (sets empty user object)
	 *          - User object: Token is valid and user data is provided
	 */
	validate: (token: string, ctx: Context<T>) => boolean | Record<string, unknown> | Promise<boolean | Record<string, unknown>>;

	/**
	 * The authentication scheme presented in WWW-Authenticate header.
	 * Default: "Bearer"
	 */
	scheme?: string;

	/**
	 * Optional realm for the WWW-Authenticate header.
	 * If provided, will be included as: Bearer realm="<realm>"
	 */
	realm?: string;

	/**
	 * The key in the context where authenticated user information is stored.
	 * Default: "user"
	 */
	contextKey?: keyof T;

	/**
	 * Custom error message for missing token.
	 * Default: "Authorization token required"
	 */
	missingTokenMessage?: string;

	/**
	 * Custom error message for invalid token.
	 * Default: "Invalid or expired token"
	 */
	invalidTokenMessage?: string;
}

/**
 * Bearer Token Authentication middleware for JWT or API tokens.
 *
 * Validates bearer tokens and adds user information to the context on successful authentication.
 *
 * @template T - The context's data type.
 * @param {BearerAuthOptions<T>} options - Configuration options including validation function.
 * @returns {Middleware<T>} - Middleware function for bearer token authentication.
 *
 * @example
 * ```typescript
 * // Simple token validation
 * app.use(bearerAuth({
 *   validate: (token) => token === "secret-api-key"
 * }));
 *
 * // JWT validation with user data
 * app.use(bearerAuth({
 *   validate: async (token) => {
 *     try {
 *       const payload = jwt.verify(token, JWT_SECRET);
 *       return { id: payload.sub, email: payload.email };
 *     } catch {
 *       return false;
 *     }
 *   },
 *   contextKey: "currentUser"
 * }));
 *
 * // Database token validation
 * app.use(bearerAuth({
 *   validate: async (token) => {
 *     const apiKey = await db.apiKeys.findOne({ token, active: true });
 *     if (!apiKey) return false;
 *     return { userId: apiKey.userId, permissions: apiKey.permissions };
 *   }
 * }));
 * ```
 */
export function bearerAuth<T extends Record<string, unknown> = Record<string, unknown>>(options: BearerAuthOptions<T>): Middleware<T> {
	const {
		validate,
		scheme = "Bearer",
		realm,
		contextKey = "user" as keyof T,
		missingTokenMessage = "Authorization token required",
		invalidTokenMessage = "Invalid or expired token",
	} = options;

	return async (ctx: Context<T>, next) => {
		const auth = ctx.req.headers.get("Authorization");

		if (!auth || !auth.startsWith("Bearer ")) {
			// Set WWW-Authenticate header
			let challenge = scheme;
			if (realm) {
				challenge += ` realm="${realm}"`;
			}
			ctx.header("WWW-Authenticate", challenge);
			return ctx.json({ error: missingTokenMessage }, 401);
		}

		try {
			const token = auth.slice(7); // Remove "Bearer " prefix

			if (!token.trim()) {
				ctx.header("WWW-Authenticate", scheme);
				return ctx.json({ error: missingTokenMessage }, 401);
			}

			const result = await validate(token, ctx);

			if (result === false) {
				ctx.header("WWW-Authenticate", scheme);
				return ctx.json({ error: invalidTokenMessage }, 401);
			}

			// Set user data in context
			if (result === true) {
				// Valid token but no user data provided
				ctx.set(contextKey, {} as T[keyof T]);
			} else {
				// User data provided from validation
				ctx.set(contextKey, result as T[keyof T]);
			}

			return next();
		} catch (error) {
			ctx.header("WWW-Authenticate", scheme);
			return ctx.json({ error: invalidTokenMessage }, 500);
		}
	};
}
