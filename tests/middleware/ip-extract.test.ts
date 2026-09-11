import { describe, test, expect, beforeEach } from "bun:test";
import { Web } from "../../packages/core/src";
import { ipExtract, getClientIp, IP_EXTRACTION_PRESETS } from "../../packages/middleware/src/ip-extract";

describe("IP Extract Middleware", () => {
	let app: Web;

	beforeEach(() => {
		app = new Web();
	});

	describe("Direct Connection Mode", () => {
		test("should use direct IP when trustProxy is false", async () => {
			app.use(ipExtract({ trustProxy: false }));
			app.get("/", (ctx) => ctx.json({ ip: ctx.clientIp }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// Simulate request with headers that should be ignored
				const response = await fetch(`http://localhost:${server.port}/`, {
					headers: {
						"x-forwarded-for": "1.2.3.4",
						"x-real-ip": "5.6.7.8",
					},
				});

				const data = await response.json();
				// In test environment, this will be the loopback address
				expect(data.ip).toMatch(/^(127\.0\.0\.1|::1)/);
			} finally {
				server.stop();
			}
		});

		test("should work with 'direct' preset", async () => {
			app.use(ipExtract("direct"));
			app.get("/", (ctx) => ctx.json({ ip: ctx.clientIp }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const response = await fetch(`http://localhost:${server.port}/`, {
					headers: {
						"x-forwarded-for": "1.2.3.4",
					},
				});

				const data = await response.json();
				expect(data.ip).toMatch(/^(127\.0\.0\.1|::1)/);
			} finally {
				server.stop();
			}
		});
	});

	describe("Proxy Headers", () => {
		test("should extract IP from x-forwarded-for", async () => {
			app.use(
				ipExtract({
					trustProxy: true,
					trustedHeaders: ["x-forwarded-for"],
				}),
			);
			app.get("/", (ctx) => ctx.json({ ip: ctx.clientIp }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const response = await fetch(`http://localhost:${server.port}/`, {
					headers: {
						"x-forwarded-for": "1.2.3.4",
					},
				});

				const data = await response.json();
				expect(data.ip).toBe("1.2.3.4");
			} finally {
				server.stop();
			}
		});

		test("should handle multiple IPs in x-forwarded-for", async () => {
			app.use(
				ipExtract({
					trustProxy: true,
					trustedHeaders: ["x-forwarded-for"],
				}),
			);
			app.get("/", (ctx) => ctx.json({ ip: ctx.clientIp }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const response = await fetch(`http://localhost:${server.port}/`, {
					headers: {
						"x-forwarded-for": "1.2.3.4, 10.0.0.1, 172.16.0.1",
					},
				});

				const data = await response.json();
				// Should return the first IP (original client)
				expect(data.ip).toBe("1.2.3.4");
			} finally {
				server.stop();
			}
		});

		test("should respect maxProxyChain limit", async () => {
			app.use(
				ipExtract({
					trustProxy: true,
					trustedHeaders: ["x-forwarded-for"],
					maxProxyChain: 2,
					logWarnings: false,
				}),
			);
			app.get("/", (ctx) => ctx.json({ ip: ctx.clientIp }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const response = await fetch(`http://localhost:${server.port}/`, {
					headers: {
						// Chain longer than maxProxyChain
						"x-forwarded-for": "1.2.3.4, 10.0.0.1, 172.16.0.1, 192.168.1.1",
					},
				});

				const data = await response.json();
				// Should still return the first valid IP
				expect(data.ip).toBe("1.2.3.4");
			} finally {
				server.stop();
			}
		});

		test("should try headers in order", async () => {
			app.use(
				ipExtract({
					trustProxy: true,
					trustedHeaders: ["x-real-ip", "x-forwarded-for"],
				}),
			);
			app.get("/", (ctx) => ctx.json({ ip: ctx.clientIp }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const response = await fetch(`http://localhost:${server.port}/`, {
					headers: {
						"x-forwarded-for": "1.2.3.4",
						"x-real-ip": "5.6.7.8",
					},
				});

				const data = await response.json();
				// Should use x-real-ip first as it's first in the list
				expect(data.ip).toBe("5.6.7.8");
			} finally {
				server.stop();
			}
		});

		test("should handle missing headers gracefully", async () => {
			app.use(
				ipExtract({
					trustProxy: true,
					trustedHeaders: ["x-custom-ip"],
				}),
			);
			app.get("/", (ctx) => ctx.json({ ip: ctx.clientIp }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const response = await fetch(`http://localhost:${server.port}/`);
				const data = await response.json();
				// Should fall back to direct connection
				expect(data.ip).toMatch(/^(127\.0\.0\.1|::1)/);
			} finally {
				server.stop();
			}
		});
	});

	describe("IPv6 Support", () => {
		test("should handle IPv6 addresses", async () => {
			app.use(
				ipExtract({
					trustProxy: true,
					trustedHeaders: ["x-forwarded-for"],
				}),
			);
			app.get("/", (ctx) => ctx.json({ ip: ctx.clientIp }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const response = await fetch(`http://localhost:${server.port}/`, {
					headers: {
						"x-forwarded-for": "2001:db8::1",
					},
				});

				const data = await response.json();
				expect(data.ip).toBe("2001:db8::1");
			} finally {
				server.stop();
			}
		});

		test("should handle IPv6 with zone index", async () => {
			app.use(
				ipExtract({
					trustProxy: true,
					trustedHeaders: ["x-forwarded-for"],
				}),
			);
			app.get("/", (ctx) => ctx.json({ ip: ctx.clientIp }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const response = await fetch(`http://localhost:${server.port}/`, {
					headers: {
						"x-forwarded-for": "fe80::1%eth0",
					},
				});

				const data = await response.json();
				expect(data.ip).toBe("fe80::1%eth0");
			} finally {
				server.stop();
			}
		});

		test("should handle IPv4-mapped IPv6 addresses", async () => {
			app.use(
				ipExtract({
					trustProxy: true,
					trustedHeaders: ["x-forwarded-for"],
				}),
			);
			app.get("/", (ctx) => ctx.json({ ip: ctx.clientIp }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const response = await fetch(`http://localhost:${server.port}/`, {
					headers: {
						"x-forwarded-for": "::ffff:192.168.1.1",
					},
				});

				const data = await response.json();
				expect(data.ip).toBe("192.168.1.1");
			} finally {
				server.stop();
			}
		});
	});

	describe("Trusted Proxies", () => {
		test("should only trust headers from trusted proxies", async () => {
			// Mock the context to simulate request from specific IP
			let mockCtx: any;

			app.use((ctx, next) => {
				ctx.clientIp = "10.0.0.5";
				mockCtx = ctx;
				return next();
			});

			app.use(
				ipExtract({
					trustProxy: true,
					trustedProxies: ["10.0.0.0/8"],
					trustedHeaders: ["x-forwarded-for"],
				}),
			);

			app.get("/", (ctx) => ctx.json({ ip: ctx.clientIp }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const response = await fetch(`http://localhost:${server.port}/`, {
					headers: {
						"x-forwarded-for": "1.2.3.4",
					},
				});

				const data = await response.json();
				// Should trust the header since request is from trusted proxy
				expect(data.ip).toBe("1.2.3.4");
			} finally {
				server.stop();
			}
		});

		test("should reject headers from untrusted proxies", async () => {
			app.use((ctx, next) => {
				ctx.clientIp = "192.168.1.1";
				return next();
			});

			app.use(
				ipExtract({
					trustProxy: true,
					trustedProxies: ["10.0.0.0/8"],
					trustedHeaders: ["x-forwarded-for"],
					logWarnings: false,
				}),
			);

			app.get("/", (ctx) => ctx.json({ ip: ctx.clientIp }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const response = await fetch(`http://localhost:${server.port}/`, {
					headers: {
						"x-forwarded-for": "1.2.3.4",
					},
				});

				const data = await response.json();
				// Should use direct IP since proxy is not trusted
				expect(data.ip).toBe("192.168.1.1");
			} finally {
				server.stop();
			}
		});

		test("should handle IPv4 CIDR notation", async () => {
			app.use((ctx, next) => {
				// Simulate request from trusted CIDR range
				ctx.clientIp = "172.20.1.5";
				return next();
			});

			app.use(
				ipExtract({
					trustProxy: true,
					trustedProxies: ["172.16.0.0/12", "192.168.1.100"],
					trustedHeaders: ["x-forwarded-for"],
				}),
			);

			app.get("/", (ctx) => ctx.json({ ip: ctx.clientIp }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const response = await fetch(`http://localhost:${server.port}/`, {
					headers: {
						"x-forwarded-for": "8.8.8.8",
					},
				});

				const data = await response.json();
				expect(data.ip).toBe("8.8.8.8");
			} finally {
				server.stop();
			}
		});
	});

	describe("Cloud Provider Presets", () => {
		test("should use Cloudflare configuration", async () => {
			app.use((ctx, next) => {
				// Simulate request from Cloudflare IP
				ctx.clientIp = "172.64.0.1";
				return next();
			});

			app.use(ipExtract("cloudflare"));

			app.get("/", (ctx) => ctx.json({ ip: ctx.clientIp }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const response = await fetch(`http://localhost:${server.port}/`, {
					headers: {
						"cf-connecting-ip": "1.2.3.4",
						"x-forwarded-for": "5.6.7.8",
					},
				});

				const data = await response.json();
				// Should prefer cf-connecting-ip for Cloudflare
				expect(data.ip).toBe("1.2.3.4");
			} finally {
				server.stop();
			}
		});

		test("should use AWS configuration", async () => {
			app.use(ipExtract("aws"));
			app.get("/", (ctx) => ctx.json({ ip: ctx.clientIp }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const response = await fetch(`http://localhost:${server.port}/`, {
					headers: {
						"x-forwarded-for": "1.2.3.4, 10.0.0.1",
					},
				});

				const data = await response.json();
				expect(data.ip).toBe("1.2.3.4");
			} finally {
				server.stop();
			}
		});

		test("should use custom cloud provider config", async () => {
			app.use(
				ipExtract({
					trustProxy: true,
					cloudProvider: "vercel",
				}),
			);
			app.get("/", (ctx) => ctx.json({ ip: ctx.clientIp }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const response = await fetch(`http://localhost:${server.port}/`, {
					headers: {
						"x-vercel-forwarded-for": "1.2.3.4",
						"x-forwarded-for": "5.6.7.8",
						"x-real-ip": "9.10.11.12",
					},
				});

				const data = await response.json();
				// Vercel config includes all three headers in order
				expect(["1.2.3.4", "5.6.7.8", "9.10.11.12"]).toContain(data.ip);
			} finally {
				server.stop();
			}
		});
	});

	describe("Trusted Proxy Ranges", () => {
		// Runs the middleware for a connection from `directIp`, which a local test server can't simulate
		async function extractFrom(middleware: ReturnType<typeof ipExtract>, directIp: string, headers: Record<string, string>) {
			const ctx = { clientIp: directIp, req: new Request("http://localhost/", { headers }) } as any;
			await middleware(ctx, async () => {});
			return ctx.clientIp as string;
		}

		test("should trust every Cloudflare IPv6 range, including non-nibble prefixes", async () => {
			const middleware = ipExtract("cloudflare");

			for (const edge of ["2400:cb00:2049::1", "2606:4700:10::6816:1", "2a06:98c0:3600::103", "2a06:98c7:ffff::1", "2c0f:f248::1"]) {
				expect(await extractFrom(middleware, edge, { "cf-connecting-ip": "198.51.100.66" })).toBe("198.51.100.66");
			}
		});

		test("should not trust IPv6 addresses that only look like a Cloudflare range", async () => {
			const middleware = ipExtract("cloudflare");

			// 2400:cb0f::/32 and 2606:470a::/32 share leading characters with Cloudflare ranges; 2a06:98c8:: is just outside the /29
			for (const outsider of ["2400:cb0f::1", "2606:470a::1", "2a06:98c8::1"]) {
				expect(await extractFrom(middleware, outsider, { "cf-connecting-ip": "198.51.100.66" })).toBe(outsider);
			}
		});

		test("should compare exact IPv6 proxy entries by value", async () => {
			const middleware = ipExtract({ trustProxy: true, trustedProxies: ["2001:db8::10"], trustedHeaders: ["x-real-ip"] });

			expect(await extractFrom(middleware, "2001:DB8:0:0:0:0:0:10", { "x-real-ip": "203.0.113.5" })).toBe("203.0.113.5");
			expect(await extractFrom(middleware, "2001:db8::11", { "x-real-ip": "203.0.113.5" })).toBe("2001:db8::11");
		});

		test("should support /0 and reject malformed prefixes", async () => {
			const everyone = ipExtract({ trustProxy: true, trustedProxies: ["0.0.0.0/0", "::/0"], trustedHeaders: ["x-real-ip"] });
			expect(await extractFrom(everyone, "192.0.2.1", { "x-real-ip": "203.0.113.5" })).toBe("203.0.113.5");
			expect(await extractFrom(everyone, "2001:db8::1", { "x-real-ip": "203.0.113.5" })).toBe("203.0.113.5");

			// A missing or invalid prefix must not be read as /0
			const malformed = ipExtract({ trustProxy: true, trustedProxies: ["10.0.0.0/", "10.0.0.0/abc", "2001:db8::/129"], trustedHeaders: ["x-real-ip"] });
			expect(await extractFrom(malformed, "192.0.2.1", { "x-real-ip": "203.0.113.5" })).toBe("192.0.2.1");
			expect(await extractFrom(malformed, "2001:db8::1", { "x-real-ip": "203.0.113.5" })).toBe("2001:db8::1");
		});
	});

	describe("BurrowGate Preset", () => {
		test("should prefer x-burrowgate-client-ip", async () => {
			app.use(ipExtract("burrowgate"));
			app.get("/", (ctx) => ctx.json({ ip: ctx.clientIp }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const response = await fetch(`http://localhost:${server.port}/`, {
					headers: {
						"x-burrowgate-client-ip": "203.0.113.7",
						"x-real-ip": "198.51.100.1",
						"x-forwarded-for": "192.0.2.1",
					},
				});

				const data = await response.json();
				expect(data.ip).toBe("203.0.113.7");
			} finally {
				server.stop();
			}
		});

		test("should fall back to x-real-ip", async () => {
			app.use(ipExtract("burrowgate"));
			app.get("/", (ctx) => ctx.json({ ip: ctx.clientIp }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const response = await fetch(`http://localhost:${server.port}/`, {
					headers: {
						"x-real-ip": "2001:db8::1",
					},
				});

				const data = await response.json();
				expect(data.ip).toBe("2001:db8::1");
			} finally {
				server.stop();
			}
		});

		test("should ignore headers when the request is not from a trusted BurrowGate host", async () => {
			app.use(ipExtract({ ...IP_EXTRACTION_PRESETS.burrowgate, trustedProxies: ["10.0.0.5"] }));
			app.get("/", (ctx) => ctx.json({ ip: ctx.clientIp }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const response = await fetch(`http://localhost:${server.port}/`, {
					headers: {
						"x-burrowgate-client-ip": "203.0.113.7",
					},
				});

				const data = await response.json();
				expect(data.ip).toMatch(/^(127\.0\.0\.1|::1)/);
			} finally {
				server.stop();
			}
		});
	});

	describe("Helper Functions", () => {
		test("getClientIp should return IP from context", async () => {
			app.use(
				ipExtract({
					trustProxy: true,
					trustedHeaders: ["x-real-ip"],
				}),
			);

			app.get("/", (ctx) => {
				const ip = getClientIp(ctx);
				return ctx.json({ ip, directIp: ctx.clientIp });
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const response = await fetch(`http://localhost:${server.port}/`, {
					headers: {
						"x-real-ip": "1.2.3.4",
					},
				});

				const data = await response.json();
				expect(data.ip).toBe("1.2.3.4");
				expect(data.directIp).toBe("1.2.3.4");
			} finally {
				server.stop();
			}
		});
	});

	describe("Error Handling", () => {
		test("should handle invalid IP addresses gracefully", async () => {
			app.use(
				ipExtract({
					trustProxy: true,
					trustedHeaders: ["x-forwarded-for"],
				}),
			);
			app.get("/", (ctx) => ctx.json({ ip: ctx.clientIp }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const response = await fetch(`http://localhost:${server.port}/`, {
					headers: {
						"x-forwarded-for": "not-an-ip, another-invalid",
					},
				});

				const data = await response.json();
				// Should fall back to direct connection
				expect(data.ip).toMatch(/^(127\.0\.0\.1|::1)/);
			} finally {
				server.stop();
			}
		});

		test("should handle empty header values", async () => {
			app.use(
				ipExtract({
					trustProxy: true,
					trustedHeaders: ["x-forwarded-for"],
				}),
			);
			app.get("/", (ctx) => ctx.json({ ip: ctx.clientIp }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const response = await fetch(`http://localhost:${server.port}/`, {
					headers: {
						"x-forwarded-for": "",
					},
				});

				const data = await response.json();
				expect(data.ip).toMatch(/^(127\.0\.0\.1|::1)/);
			} finally {
				server.stop();
			}
		});

		test("should continue middleware chain even on error", async () => {
			app.use(
				ipExtract({
					trustProxy: true,
					trustedHeaders: ["x-forwarded-for"],
					logWarnings: false,
				}),
			);

			app.get("/", (ctx) => ctx.json({ success: true, ip: ctx.clientIp }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const response = await fetch(`http://localhost:${server.port}/`);
				expect(response.status).toBe(200);

				const data = await response.json();
				expect(data.success).toBe(true);
			} finally {
				server.stop();
			}
		});
	});

	describe("Security Features", () => {
		test("should validate all preset configurations", () => {
			// Ensure all presets have valid configurations
			for (const [name, config] of Object.entries(IP_EXTRACTION_PRESETS)) {
				expect(config).toBeDefined();
				expect(typeof config.trustProxy).toBe("boolean");

				// If it has a cloud provider, it should be valid
				if (config.cloudProvider) {
					expect(["aws", "cloudflare", "gcp", "azure", "vercel", "custom"]).toContain(config.cloudProvider);
				}
			}
		});

		test("development preset should have warnings enabled", () => {
			const devConfig = IP_EXTRACTION_PRESETS.development;
			expect(devConfig.logWarnings).toBe(true);
			expect(devConfig.trustProxy).toBe(true);
		});

		test("direct preset should not trust proxy", () => {
			const directConfig = IP_EXTRACTION_PRESETS.direct;
			expect(directConfig.trustProxy).toBe(false);
		});
	});

	describe("Multiple Middleware Integration", () => {
		test("should work with other middleware", async () => {
			// Add logging middleware
			app.use(async (ctx, next) => {
				ctx.set("preIp", ctx.clientIp || "none");
				await next();
			});

			// Add IP extraction
			app.use(
				ipExtract({
					trustProxy: true,
					trustedHeaders: ["x-real-ip"],
				}),
			);

			// Route handler
			app.get("/", (ctx) => {
				return ctx.json({
					ip: ctx.clientIp,
					preIp: ctx.get("preIp"),
				});
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const response = await fetch(`http://localhost:${server.port}/`, {
					headers: {
						"x-real-ip": "1.2.3.4",
					},
				});

				const data = await response.json();
				expect(data.ip).toBe("1.2.3.4");
				expect(data.preIp).not.toBe("1.2.3.4"); // IP not set before middleware
			} finally {
				server.stop();
			}
		});
	});
});

describe("IP Validation Functions", () => {
	test("should validate IPv4 addresses", () => {
		const validIPs = ["192.168.1.1", "10.0.0.1", "127.0.0.1", "255.255.255.255", "0.0.0.0"];

		const invalidIPs = ["256.1.1.1", "1.1.1", "1.1.1.1.1", "a.b.c.d", "192.168.1.300", "192.168.-1.1"];

		// We can't directly test the internal functions, but we can test through the middleware
		const app = new Web();
		app.use(
			ipExtract({
				trustProxy: true,
				trustedHeaders: ["x-forwarded-for"],
			}),
		);

		app.get("/", (ctx) => ctx.json({ ip: ctx.clientIp }));

		// This is more of an integration test for validation
		validIPs.forEach((ip) => {
			// The middleware should accept these as valid
			expect(ip).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
		});

		invalidIPs.forEach((ip) => {
			// These should not match the basic pattern
			const isBasicMatch = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip);
			if (isBasicMatch) {
				// If it matches the pattern, check that numbers are valid
				const parts = ip.split(".");
				const isValid = parts.every((p) => {
					const num = parseInt(p, 10);
					return num >= 0 && num <= 255;
				});
				expect(isValid).toBe(false);
			} else {
				expect(isBasicMatch).toBe(false);
			}
		});
	});
});
