import type { Context, Middleware } from "@rabbit-company/web";
// Re-exported for compatibility with earlier releases; prefer importing these from "@rabbit-company/web"
export type { Context, Middleware, Next } from "@rabbit-company/web";
import { BURROWGATE_SESSION_ASSERTION_HEADER, BurrowGateClient, verifyOriginRequest } from "@rabbit-company/burrowgate-auth";
import type { BurrowGateClientOptions, BurrowGateSession, OriginVerificationFailureReason, OriginVerifiedRequest } from "@rabbit-company/burrowgate-auth";

export { BURROWGATE_SESSION_ASSERTION_HEADER, BurrowGateClient, BurrowGateError } from "@rabbit-company/burrowgate-auth";
export type {
	BurrowGateClientOptions,
	BurrowGateSession,
	BurrowGateUser,
	OriginVerificationFailureReason,
	OriginVerifiedRequest,
} from "@rabbit-company/burrowgate-auth";

/**
 * Options for the BurrowGate origin verification middleware.
 *
 * @template T - The shape of the context object.
 */
export interface BurrowGateOriginOptions<T extends Record<string, unknown>, B extends Record<string, unknown>> {
	/**
	 * The protected site's origin signing secret (shown in BurrowGate's site editor).
	 * Keep it server-side.
	 */
	secret: string;

	/**
	 * Maximum allowed difference, in seconds, between `X-BurrowGate-Timestamp` and the current time.
	 * Set to 0 to disable the freshness check (not recommended: captured requests could be replayed).
	 * Default: 60
	 */
	maxAgeSeconds?: number;

	/**
	 * The key in the context where the verified request details are stored.
	 * Default: "burrowgateOrigin"
	 */
	contextKey?: keyof T;

	/**
	 * Custom error message for requests that did not pass verification.
	 * Default: "Forbidden"
	 */
	forbiddenMessage?: string;

	/**
	 * Called when verification fails. Return a custom response, for example after logging the reason.
	 * Default: 403 JSON response with `forbiddenMessage`.
	 */
	onFailure?: (ctx: Context<T, B>, reason: OriginVerificationFailureReason) => Response | Promise<Response>;

	/**
	 * Whether to skip verification for specific routes (for example a local health check).
	 * Function receives the context and returns true to skip the verification.
	 */
	skip?: (ctx: Context<T, B>) => boolean | Promise<boolean>;
}

/**
 * BurrowGate origin verification middleware.
 *
 * Verifies that each request actually passed through BurrowGate by checking the
 * `X-BurrowGate-Signature` HMAC with the site's origin signing secret. Requests that
 * reached the origin directly, or whose signed headers were tampered with, are rejected.
 *
 * On success `ctx.clientIp` is set to the client IP BurrowGate observed. The IP is covered
 * by the signature, so `ipExtract` is not needed and downstream middleware like `rateLimit`,
 * `ipRestriction` and `logger` see the real client regardless of network topology.
 * The verified details are stored in the context under `contextKey`.
 *
 * Register it before any middleware that reads the request body: the timestamp is stamped
 * before BurrowGate forwards the body, so verifying after a slow upload can fail spuriously.
 *
 * @template T - The context's data type.
 * @param {BurrowGateOriginOptions<T, B>} options - Configuration options including the origin signing secret.
 * @returns {Middleware<T, B>} - Middleware function for BurrowGate origin verification.
 *
 * @example
 * ```typescript
 * app.use(burrowgateOrigin({
 *   secret: process.env.BURROWGATE_ORIGIN_SECRET!,
 * }));
 *
 * app.get("/", (ctx) => {
 *   const origin = ctx.get("burrowgateOrigin");
 *   return ctx.json({ ip: ctx.clientIp, country: origin.country, user: origin.authenticatedUser });
 * });
 * ```
 */
export function burrowgateOrigin<T extends Record<string, unknown> = Record<string, unknown>, B extends Record<string, unknown> = Record<string, unknown>>(
	options: BurrowGateOriginOptions<T, B>,
): Middleware<T, B> {
	const { secret, maxAgeSeconds = 60, contextKey = "burrowgateOrigin" as keyof T, forbiddenMessage = "Forbidden", onFailure, skip } = options;

	// Fail at startup instead of on every request
	if (typeof secret !== "string" || !secret.trim()) {
		throw new TypeError("burrowgateOrigin: secret is required");
	}
	if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds < 0) {
		throw new TypeError("burrowgateOrigin: maxAgeSeconds must be zero or a positive number");
	}

	return async (ctx: Context<T, B>, next) => {
		// Check if we should skip this request
		if (skip && (await skip(ctx))) {
			return next();
		}

		const result = await verifyOriginRequest(ctx.req, secret, { maxAgeSeconds });

		if (!result.valid) {
			if (onFailure) return onFailure(ctx, result.reason);
			return ctx.json({ error: forbiddenMessage }, 403);
		}

		ctx.clientIp = result.clientIp;
		ctx.set(contextKey, result as T[keyof T]);

		return next();
	};
}

/**
 * Anything that can authenticate a request the way {@link BurrowGateClient} does.
 */
export type BurrowGateSessionAuthenticator = Pick<BurrowGateClient, "authenticate">;

/**
 * Options for the BurrowGate session assertion middleware.
 *
 * @template T - The shape of the context object.
 */
export interface BurrowGateSessionOptions<T extends Record<string, unknown>, B extends Record<string, unknown>> {
	/**
	 * A `BurrowGateClient` instance, or the options to create one.
	 * Pass an instance to share its introspection cache between several middleware.
	 */
	client: BurrowGateSessionAuthenticator | BurrowGateClientOptions;

	/**
	 * Header carrying the browser's session assertion.
	 * Default: "x-burrowgate-session-assertion"
	 */
	headerName?: string;

	/**
	 * Continue without a session instead of responding with 401 when the assertion is missing or inactive.
	 * BurrowGate being unreachable still responds with 503.
	 * Default: false
	 */
	optional?: boolean;

	/**
	 * The key in the context where the active session is stored.
	 * Default: "burrowgateSession"
	 */
	contextKey?: keyof T;

	/**
	 * Custom error message for a missing, expired, logged-out or revoked session.
	 * Default: "Authentication required"
	 */
	unauthorizedMessage?: string;

	/**
	 * Custom error message when BurrowGate cannot be reached or rejects the verification token.
	 * Default: "Authentication service unavailable"
	 */
	unavailableMessage?: string;

	/**
	 * Called when introspection fails (network error, timeout, invalid verification token).
	 * Use it for logging; the request is answered with 503 afterwards.
	 */
	onError?: (error: unknown, ctx: Context<T, B>) => void | Promise<void>;

	/**
	 * Whether to skip authentication for specific routes.
	 * Function receives the context and returns true to skip the authentication.
	 */
	skip?: (ctx: Context<T, B>) => boolean | Promise<boolean>;
}

/**
 * BurrowGate session assertion middleware.
 *
 * Authenticates requests from a browser application that is protected by BurrowGate's
 * Access List and calls a separate backend. The browser sends a short-lived signed assertion
 * (see `BrowserSessionAssertionClient` in `@rabbit-company/burrowgate-auth`), and this
 * middleware introspects it with BurrowGate using the server-only verification token.
 *
 * - Active session: stored in the context under `contextKey`
 * - Missing or inactive assertion: 401 (or passes through when `optional` is true)
 * - BurrowGate unreachable or misconfigured: 503, never treated as an anonymous request
 *
 * Cross-origin frontends must be allowed to send the assertion header, for example
 * `cors({ allowHeaders: ["x-burrowgate-session-assertion"] })`.
 *
 * @template T - The context's data type.
 * @param {BurrowGateSessionOptions<T, B>} options - Configuration options including the BurrowGate client.
 * @returns {Middleware<T, B>} - Middleware function for BurrowGate session authentication.
 *
 * @example
 * ```typescript
 * // "/api/*" covers /api and every route below it
 * app.use("/api/*", burrowgateSession({
 *   client: {
 *     baseUrl: "https://app.example.com",
 *     siteId: "site_frontend",
 *     verificationToken: process.env.BURROWGATE_SESSION_VERIFICATION_TOKEN!,
 *   },
 * }));
 *
 * app.get("/api/me", (ctx) => {
 *   const session = ctx.get("burrowgateSession");
 *   return ctx.json({ id: session.user.id, username: session.user.username });
 * });
 * ```
 */
export function burrowgateSession<T extends Record<string, unknown> = Record<string, unknown>, B extends Record<string, unknown> = Record<string, unknown>>(
	options: BurrowGateSessionOptions<T, B>,
): Middleware<T, B> {
	const {
		headerName = BURROWGATE_SESSION_ASSERTION_HEADER,
		optional = false,
		contextKey = "burrowgateSession" as keyof T,
		unauthorizedMessage = "Authentication required",
		unavailableMessage = "Authentication service unavailable",
		onError,
		skip,
	} = options;

	// Duck-typed so an instance from a separately installed burrowgate-auth copy also works
	const client: BurrowGateSessionAuthenticator =
		typeof (options.client as BurrowGateSessionAuthenticator).authenticate === "function"
			? (options.client as BurrowGateSessionAuthenticator)
			: new BurrowGateClient(options.client as BurrowGateClientOptions);

	return async (ctx: Context<T, B>, next) => {
		// Check if we should skip this request
		if (skip && (await skip(ctx))) {
			return next();
		}

		let session: BurrowGateSession | null;
		try {
			session = await client.authenticate(ctx.req, headerName);
		} catch (error) {
			// authenticate() only throws when introspection could not be completed safely
			if (onError) await onError(error, ctx);
			return ctx.json({ error: unavailableMessage }, 503);
		}

		if (!session) {
			if (optional) return next();
			return ctx.json({ error: unauthorizedMessage }, 401);
		}

		ctx.set(contextKey, session as T[keyof T]);

		return next();
	};
}
