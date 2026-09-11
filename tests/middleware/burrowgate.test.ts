import { describe, expect, it, mock } from "bun:test";
import { createHmac } from "node:crypto";
import { Web } from "../../packages/core/src";
import { burrowgateOrigin, burrowgateSession, BurrowGateClient } from "../../packages/middleware/src/burrowgate";
import type { BurrowGateSession, OriginVerifiedRequest } from "../../packages/middleware/src/burrowgate";

const SECRET = "origin-signing-secret";

interface SignOptions {
	method?: string;
	path?: string;
	sessionId?: string;
	clientIp?: string;
	country?: string;
	timestamp?: number;
	authenticatedUser?: string;
	secret?: string;
}

function hmac(secret: string, value: string): string {
	return createHmac("sha256", secret).update(value).digest("hex");
}

/**
 * Mirrors the headers BurrowGate's proxy adds to upstream requests.
 */
function signedHeaders(options: SignOptions = {}): Record<string, string> {
	const {
		method = "GET",
		path = "/",
		sessionId = "sess_123",
		clientIp = "203.0.113.7",
		country = "SI",
		timestamp = Math.floor(Date.now() / 1000),
		authenticatedUser,
		secret = SECRET,
	} = options;

	const canonical = [method, path, sessionId, clientIp, country, String(timestamp)];
	const headers: Record<string, string> = {
		"x-real-ip": clientIp,
		"x-forwarded-for": clientIp,
		"x-burrowgate-verified": "true",
		"x-burrowgate-access-mode": "verified",
		"x-burrowgate-session-id": sessionId,
		"x-burrowgate-client-ip": clientIp,
		"x-burrowgate-country": country,
		"x-burrowgate-timestamp": String(timestamp),
		"x-burrowgate-signature": hmac(secret, canonical.join("\n")),
	};

	if (authenticatedUser) {
		headers["x-burrowgate-authenticated-user"] = authenticatedUser;
		headers["x-burrowgate-identity-signature"] = hmac(secret, [...canonical, authenticatedUser].join("\n"));
	}

	return headers;
}

function mockRequest(path: string, method = "GET", headers: Record<string, string> = {}) {
	return new Request(`http://localhost${path}`, {
		method,
		headers: {
			Host: "localhost",
			...headers,
		},
	});
}

function createOriginApp(options: Partial<Parameters<typeof burrowgateOrigin>[0]> = {}) {
	const app = new Web();
	app.use(burrowgateOrigin({ secret: SECRET, ...options }));
	app.get("/", (ctx) => ctx.json({ ip: ctx.clientIp, origin: ctx.get("burrowgateOrigin") }));
	app.get("/health", (ctx) => ctx.json({ ok: true, origin: ctx.get("burrowgateOrigin") ?? null }));
	return app;
}

describe("BurrowGate Origin Middleware", () => {
	describe("Signature Verification", () => {
		it("should accept a request signed by BurrowGate", async () => {
			const app = createOriginApp();

			const res = await app.handle(mockRequest("/", "GET", signedHeaders()));

			expect(res.status).toBe(200);
			const data = (await res.json()) as { ip: string; origin: OriginVerifiedRequest };
			expect(data.origin.valid).toBe(true);
			expect(data.origin.sessionId).toBe("sess_123");
			expect(data.origin.country).toBe("SI");
			expect(data.origin.accessMode).toBe("verified");
			expect(data.origin.verified).toBe(true);
			expect(data.origin.authenticatedUser).toBeNull();
		});

		it("should cover the query string in the signature", async () => {
			const app = new Web();
			app.use(burrowgateOrigin({ secret: SECRET }));
			app.get("/search", (ctx) => ctx.text("ok"));

			const signed = await app.handle(mockRequest("/search?q=rabbit", "GET", signedHeaders({ path: "/search?q=rabbit" })));
			const altered = await app.handle(mockRequest("/search?q=admin", "GET", signedHeaders({ path: "/search?q=rabbit" })));

			expect(signed.status).toBe(200);
			expect(altered.status).toBe(403);
		});

		it("should reject a request without BurrowGate headers", async () => {
			const app = createOriginApp();

			const res = await app.handle(mockRequest("/"));

			expect(res.status).toBe(403);
			expect(await res.json()).toEqual({ error: "Forbidden" });
		});

		it("should reject a request signed with a different secret", async () => {
			const app = createOriginApp();

			const res = await app.handle(mockRequest("/", "GET", signedHeaders({ secret: "attacker-secret" })));

			expect(res.status).toBe(403);
		});

		it("should reject a spoofed client IP", async () => {
			const app = createOriginApp();

			const res = await app.handle(
				mockRequest("/", "GET", {
					...signedHeaders({ clientIp: "203.0.113.7" }),
					"x-burrowgate-client-ip": "198.51.100.1",
				}),
			);

			expect(res.status).toBe(403);
		});

		it("should reject a request replayed with a different method", async () => {
			const app = new Web();
			app.use(burrowgateOrigin({ secret: SECRET }));
			app.post("/", (ctx) => ctx.text("ok"));

			const res = await app.handle(mockRequest("/", "POST", signedHeaders({ method: "GET" })));

			expect(res.status).toBe(403);
		});

		it("should reject a stale timestamp", async () => {
			const app = createOriginApp();

			const res = await app.handle(mockRequest("/", "GET", signedHeaders({ timestamp: Math.floor(Date.now() / 1000) - 120 })));

			expect(res.status).toBe(403);
		});

		it("should respect a custom maxAgeSeconds", async () => {
			const app = createOriginApp({ maxAgeSeconds: 300 });

			const res = await app.handle(mockRequest("/", "GET", signedHeaders({ timestamp: Math.floor(Date.now() / 1000) - 120 })));

			expect(res.status).toBe(200);
		});
	});

	describe("Client IP", () => {
		it("should set ctx.clientIp to the signed client IP", async () => {
			const app = createOriginApp();

			const res = await app.handle(mockRequest("/", "GET", signedHeaders({ clientIp: "2001:db8::42" })));

			expect(res.status).toBe(200);
			const data = (await res.json()) as { ip: string };
			expect(data.ip).toBe("2001:db8::42");
		});

		it("should replace the direct connection IP", async () => {
			const app = createOriginApp();

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const res = await fetch(`http://localhost:${server.port}/`, {
					headers: signedHeaders({ clientIp: "203.0.113.99" }),
				});

				expect(res.status).toBe(200);
				const data = (await res.json()) as { ip: string };
				expect(data.ip).toBe("203.0.113.99");
			} finally {
				server.stop();
			}
		});

		it("should make the verified IP available to later middleware", async () => {
			const app = new Web();
			const seenIps: (string | undefined)[] = [];

			app.use(burrowgateOrigin({ secret: SECRET }));
			app.use(async (ctx, next) => {
				seenIps.push(ctx.clientIp);
				return next();
			});
			app.get("/", (ctx) => ctx.text("ok"));

			await app.handle(mockRequest("/", "GET", signedHeaders({ clientIp: "192.0.2.10" })));

			expect(seenIps).toEqual(["192.0.2.10"]);
		});

		it("should not change ctx.clientIp for rejected requests", async () => {
			const app = new Web();
			const seenIps: (string | undefined)[] = [];

			app.use(
				burrowgateOrigin({
					secret: SECRET,
					onFailure: (ctx) => {
						seenIps.push(ctx.clientIp);
						return ctx.text("nope", 403);
					},
				}),
			);
			app.get("/", (ctx) => ctx.text("ok"));

			await app.handle(mockRequest("/", "GET", { ...signedHeaders(), "x-burrowgate-signature": "00" }));

			expect(seenIps).toEqual([undefined]);
		});
	});

	describe("Authenticated User", () => {
		it("should expose a verified authenticated user", async () => {
			const app = createOriginApp();

			const res = await app.handle(mockRequest("/", "GET", signedHeaders({ authenticatedUser: "alice@example.com" })));

			expect(res.status).toBe(200);
			const data = (await res.json()) as { origin: OriginVerifiedRequest };
			expect(data.origin.authenticatedUser).toBe("alice@example.com");
		});

		it("should reject a tampered authenticated user", async () => {
			const app = createOriginApp();

			const res = await app.handle(
				mockRequest("/", "GET", {
					...signedHeaders({ authenticatedUser: "alice@example.com" }),
					"x-burrowgate-authenticated-user": "admin@example.com",
				}),
			);

			expect(res.status).toBe(403);
		});

		it("should reject an authenticated user without an identity signature", async () => {
			const app = createOriginApp();

			const res = await app.handle(
				mockRequest("/", "GET", {
					...signedHeaders(),
					"x-burrowgate-authenticated-user": "admin@example.com",
				}),
			);

			expect(res.status).toBe(403);
		});
	});

	describe("Options", () => {
		it("should use a custom forbidden message", async () => {
			const app = createOriginApp({ forbiddenMessage: "Direct access is not allowed" });

			const res = await app.handle(mockRequest("/"));

			expect(res.status).toBe(403);
			expect(await res.json()).toEqual({ error: "Direct access is not allowed" });
		});

		it("should pass the failure reason to onFailure", async () => {
			const reasons: string[] = [];
			const app = createOriginApp({
				onFailure: (ctx, reason) => {
					reasons.push(reason);
					return ctx.json({ error: "custom" }, 401);
				},
			});

			const missing = await app.handle(mockRequest("/"));
			const stale = await app.handle(mockRequest("/", "GET", signedHeaders({ timestamp: 1 })));
			const invalid = await app.handle(mockRequest("/", "GET", signedHeaders({ secret: "wrong" })));
			const identity = await app.handle(mockRequest("/", "GET", { ...signedHeaders(), "x-burrowgate-identity-signature": "00" }));

			expect(missing.status).toBe(401);
			expect(await missing.json()).toEqual({ error: "custom" });
			expect(reasons).toEqual(["missing-headers", "stale-timestamp", "invalid-signature", "invalid-identity-signature"]);
			expect([stale.status, invalid.status, identity.status]).toEqual([401, 401, 401]);
		});

		it("should store the result under a custom context key", async () => {
			const app = new Web<{ bg: OriginVerifiedRequest }>();
			app.use(burrowgateOrigin({ secret: SECRET, contextKey: "bg" }));
			app.get("/", (ctx) => ctx.json({ country: ctx.get("bg").country }));

			const res = await app.handle(mockRequest("/", "GET", signedHeaders({ country: "DE" })));

			expect(await res.json()).toEqual({ country: "DE" });
		});

		it("should skip verification when skip returns true", async () => {
			const app = createOriginApp({ skip: (ctx) => new URL(ctx.req.url).pathname === "/health" });

			const health = await app.handle(mockRequest("/health"));
			const root = await app.handle(mockRequest("/"));

			expect(health.status).toBe(200);
			expect(await health.json()).toEqual({ ok: true, origin: null });
			expect(root.status).toBe(403);
		});

		it("should throw at startup without a secret", () => {
			expect(() => burrowgateOrigin({ secret: "" })).toThrow(TypeError);
			expect(() => burrowgateOrigin({ secret: "   " })).toThrow(TypeError);
		});

		it("should throw at startup with an invalid maxAgeSeconds", () => {
			expect(() => burrowgateOrigin({ secret: SECRET, maxAgeSeconds: -1 })).toThrow(TypeError);
			expect(() => burrowgateOrigin({ secret: SECRET, maxAgeSeconds: Number.NaN })).toThrow(TypeError);
		});
	});
});

const ACTIVE_SESSION: BurrowGateSession = {
	active: true,
	siteId: "site_frontend",
	sessionId: "sess_abc",
	user: { id: "user_1", username: "alice@example.com" },
	authenticatedAt: Date.now() - 60_000,
	expiresAt: Date.now() + 3_600_000,
	assertionExpiresAt: Date.now() + 300_000,
};

/**
 * Stands in for BurrowGate's introspection endpoint.
 * "valid" is active, "revoked" is inactive, and "down" simulates a network failure.
 */
function introspectionFetch() {
	return mock(async (input: string | URL | Request, init?: RequestInit) => {
		const headers = new Headers(init?.headers);
		if (headers.get("authorization") !== "Bearer verification-token") {
			return Response.json({ error: "Invalid session verification credentials" }, { status: 401 });
		}

		const { token } = JSON.parse(String(init?.body)) as { token: string };
		if (token === "down") throw new TypeError("fetch failed");
		if (token === "valid") return Response.json(ACTIVE_SESSION);
		return Response.json({ active: false });
	});
}

function clientOptions(fetchImpl = introspectionFetch(), verificationToken = "verification-token") {
	return {
		baseUrl: "https://app.example.com",
		siteId: "site_frontend",
		verificationToken,
		fetch: fetchImpl,
	};
}

function createSessionApp(options: Partial<Parameters<typeof burrowgateSession>[0]> = {}) {
	const app = new Web();
	app.use(burrowgateSession({ client: clientOptions(), ...options }));
	app.get("/me", (ctx) => ctx.json({ session: ctx.get("burrowgateSession") ?? null }));
	return app;
}

describe("BurrowGate Session Middleware", () => {
	describe("Assertion Validation", () => {
		it("should reject requests without an assertion", async () => {
			const app = createSessionApp();

			const res = await app.handle(mockRequest("/me"));

			expect(res.status).toBe(401);
			expect(await res.json()).toEqual({ error: "Authentication required" });
		});

		it("should accept an active assertion and store the session", async () => {
			const fetchImpl = introspectionFetch();
			const app = createSessionApp({ client: clientOptions(fetchImpl) });

			const res = await app.handle(mockRequest("/me", "GET", { "x-burrowgate-session-assertion": "valid" }));

			expect(res.status).toBe(200);
			const data = (await res.json()) as { session: BurrowGateSession };
			expect(data.session.user).toEqual({ id: "user_1", username: "alice@example.com" });
			expect(data.session.sessionId).toBe("sess_abc");

			expect(fetchImpl).toHaveBeenCalledTimes(1);
			const [url, init] = fetchImpl.mock.calls[0];
			expect(String(url)).toBe("https://app.example.com/_burrowgate/api/access/session/introspect");
			expect(new Headers(init?.headers).get("x-burrowgate-site-id")).toBe("site_frontend");
		});

		it("should reject an inactive assertion", async () => {
			const app = createSessionApp();

			const res = await app.handle(mockRequest("/me", "GET", { "x-burrowgate-session-assertion": "revoked" }));

			expect(res.status).toBe(401);
		});

		it("should reuse cached introspection results", async () => {
			const fetchImpl = introspectionFetch();
			const app = createSessionApp({ client: clientOptions(fetchImpl) });

			await app.handle(mockRequest("/me", "GET", { "x-burrowgate-session-assertion": "valid" }));
			await app.handle(mockRequest("/me", "GET", { "x-burrowgate-session-assertion": "valid" }));

			expect(fetchImpl).toHaveBeenCalledTimes(1);
		});
	});

	describe("Unavailable Authority", () => {
		it("should respond with 503 when BurrowGate is unreachable", async () => {
			const errors: unknown[] = [];
			const app = createSessionApp({ onError: (error) => void errors.push(error) });

			const res = await app.handle(mockRequest("/me", "GET", { "x-burrowgate-session-assertion": "down" }));

			expect(res.status).toBe(503);
			expect(await res.json()).toEqual({ error: "Authentication service unavailable" });
			expect(errors).toHaveLength(1);
			expect((errors[0] as Error).name).toBe("BurrowGateError");
		});

		it("should respond with 503 when the verification token is rejected", async () => {
			const app = createSessionApp({ client: clientOptions(introspectionFetch(), "wrong-token") });

			const res = await app.handle(mockRequest("/me", "GET", { "x-burrowgate-session-assertion": "valid" }));

			expect(res.status).toBe(503);
		});

		it("should respond with 503 even when optional", async () => {
			const app = createSessionApp({ optional: true });

			const res = await app.handle(mockRequest("/me", "GET", { "x-burrowgate-session-assertion": "down" }));

			expect(res.status).toBe(503);
		});
	});

	describe("Options", () => {
		it("should continue without a session when optional", async () => {
			const app = createSessionApp({ optional: true });

			const missing = await app.handle(mockRequest("/me"));
			const revoked = await app.handle(mockRequest("/me", "GET", { "x-burrowgate-session-assertion": "revoked" }));
			const valid = await app.handle(mockRequest("/me", "GET", { "x-burrowgate-session-assertion": "valid" }));

			expect(missing.status).toBe(200);
			expect(await missing.json()).toEqual({ session: null });
			expect(revoked.status).toBe(200);
			expect(await revoked.json()).toEqual({ session: null });
			expect(((await valid.json()) as { session: BurrowGateSession }).session.user.id).toBe("user_1");
		});

		it("should accept an existing BurrowGateClient instance", async () => {
			const fetchImpl = introspectionFetch();
			const client = new BurrowGateClient(clientOptions(fetchImpl));
			const app = new Web();
			app.use("/a", burrowgateSession({ client }));
			app.use("/b", burrowgateSession({ client }));
			app.get("/a", (ctx) => ctx.text("a"));
			app.get("/b", (ctx) => ctx.text("b"));

			const a = await app.handle(mockRequest("/a", "GET", { "x-burrowgate-session-assertion": "valid" }));
			const b = await app.handle(mockRequest("/b", "GET", { "x-burrowgate-session-assertion": "valid" }));

			expect([a.status, b.status]).toEqual([200, 200]);
			// Both middleware share one introspection cache
			expect(fetchImpl).toHaveBeenCalledTimes(1);
		});

		it("should accept any object with an authenticate method", async () => {
			const authenticate = mock(async (request: Request, headerName?: string) => (request.headers.get(headerName ?? "") === "valid" ? ACTIVE_SESSION : null));
			const app = createSessionApp({ client: { authenticate }, headerName: "x-custom-assertion" });

			const res = await app.handle(mockRequest("/me", "GET", { "x-custom-assertion": "valid" }));

			expect(res.status).toBe(200);
			expect(authenticate.mock.calls[0][1]).toBe("x-custom-assertion");
		});

		it("should use custom messages and context key", async () => {
			const app = new Web<{ auth: BurrowGateSession }>();
			app.use(
				burrowgateSession({
					client: clientOptions(),
					contextKey: "auth",
					unauthorizedMessage: "Please sign in",
					unavailableMessage: "Try again later",
				}),
			);
			app.get("/me", (ctx) => ctx.json({ username: ctx.get("auth").user.username }));

			const valid = await app.handle(mockRequest("/me", "GET", { "x-burrowgate-session-assertion": "valid" }));
			const missing = await app.handle(mockRequest("/me"));
			const down = await app.handle(mockRequest("/me", "GET", { "x-burrowgate-session-assertion": "down" }));

			expect(await valid.json()).toEqual({ username: "alice@example.com" });
			expect(await missing.json()).toEqual({ error: "Please sign in" });
			expect(await down.json()).toEqual({ error: "Try again later" });
		});

		it("should skip authentication when skip returns true", async () => {
			const app = createSessionApp({ skip: (ctx) => ctx.req.method === "OPTIONS" });
			app.options("/me", (ctx) => ctx.text("preflight"));

			const res = await app.handle(mockRequest("/me", "OPTIONS"));

			expect(res.status).toBe(200);
			expect(await res.text()).toBe("preflight");
		});

		it("should throw at startup with invalid client options", () => {
			expect(() => burrowgateSession({ client: { baseUrl: "https://app.example.com", siteId: "", verificationToken: "t" } })).toThrow(TypeError);
			expect(() => burrowgateSession({ client: { baseUrl: "ftp://app.example.com", siteId: "s", verificationToken: "t" } })).toThrow(TypeError);
		});

		it("should protect every route below a wildcard path", async () => {
			const app = new Web();
			app.use("/api/*", burrowgateSession({ client: clientOptions() }));
			app.get("/api", (ctx) => ctx.text("root"));
			app.get("/api/me", (ctx) => ctx.text("me"));
			app.get("/api/users/:id", (ctx) => ctx.text("user"));
			app.get("/public", (ctx) => ctx.text("public"));

			for (const path of ["/api", "/api/me", "/api/users/1"]) {
				expect((await app.handle(mockRequest(path))).status).toBe(401);
				expect((await app.handle(mockRequest(path, "GET", { "x-burrowgate-session-assertion": "valid" }))).status).toBe(200);
			}
			expect((await app.handle(mockRequest("/public"))).status).toBe(200);
		});
	});
});
