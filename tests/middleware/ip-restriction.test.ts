import { describe, it, expect, beforeEach } from "bun:test";
import { Web, type Context } from "@rabbit-company/web";
import { ipRestriction, ipRestrictionPresets, createDynamicIpRestriction } from "../../packages/middleware/src/ip-restriction";

describe("IP Restriction Middleware", () => {
	let app: Web;

	beforeEach(() => {
		app = new Web();
	});

	// Helper middleware to set client IP for testing
	function setClientIp(ip: string) {
		return (ctx: Context, next: () => Promise<void | Response>) => {
			ctx.clientIp = ip;
			return next();
		};
	}

	describe("Whitelist Mode", () => {
		it("should allow IPs in whitelist", async () => {
			app.use(setClientIp("192.168.1.100"));
			app.use(
				ipRestriction({
					mode: "whitelist",
					ips: ["192.168.1.100", "10.0.0.1"],
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			const res1 = await app.handle(new Request("http://localhost/"));
			expect(res1.status).toBe(200);
			expect(await res1.text()).toBe("OK");

			// Test another allowed IP
			app = new Web();
			app.use(setClientIp("10.0.0.1"));
			app.use(
				ipRestriction({
					mode: "whitelist",
					ips: ["192.168.1.100", "10.0.0.1"],
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			const res2 = await app.handle(new Request("http://localhost/"));
			expect(res2.status).toBe(200);
		});

		it("should block IPs not in whitelist", async () => {
			app.use(setClientIp("192.168.1.101"));
			app.use(
				ipRestriction({
					mode: "whitelist",
					ips: ["192.168.1.100"],
					message: "Not allowed",
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			const res = await app.handle(new Request("http://localhost/"));
			expect(res.status).toBe(403);
			expect(await res.text()).toBe("Not allowed");
		});

		it("should support CIDR ranges in whitelist", async () => {
			// Test IP within range
			app.use(setClientIp("192.168.1.50"));
			app.use(
				ipRestriction({
					mode: "whitelist",
					ips: ["192.168.1.0/24", "10.0.0.0/8"],
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			const res1 = await app.handle(new Request("http://localhost/"));
			expect(res1.status).toBe(200);

			// Test another IP within different range
			app = new Web();
			app.use(setClientIp("10.100.50.1"));
			app.use(
				ipRestriction({
					mode: "whitelist",
					ips: ["192.168.1.0/24", "10.0.0.0/8"],
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			const res2 = await app.handle(new Request("http://localhost/"));
			expect(res2.status).toBe(200);

			// Test IP outside range
			app = new Web();
			app.use(setClientIp("192.168.2.1"));
			app.use(
				ipRestriction({
					mode: "whitelist",
					ips: ["192.168.1.0/24", "10.0.0.0/8"],
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			const res3 = await app.handle(new Request("http://localhost/"));
			expect(res3.status).toBe(403);
		});
	});

	describe("Blacklist Mode", () => {
		it("should block IPs in blacklist", async () => {
			app.use(setClientIp("192.168.1.100"));
			app.use(
				ipRestriction({
					mode: "blacklist",
					ips: ["192.168.1.100", "10.0.0.1"],
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			const res1 = await app.handle(new Request("http://localhost/"));
			expect(res1.status).toBe(403);

			// Test another blocked IP
			app = new Web();
			app.use(setClientIp("10.0.0.1"));
			app.use(
				ipRestriction({
					mode: "blacklist",
					ips: ["192.168.1.100", "10.0.0.1"],
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			const res2 = await app.handle(new Request("http://localhost/"));
			expect(res2.status).toBe(403);
		});

		it("should allow IPs not in blacklist", async () => {
			app.use(setClientIp("192.168.1.101"));
			app.use(
				ipRestriction({
					mode: "blacklist",
					ips: ["192.168.1.100"],
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			const res = await app.handle(new Request("http://localhost/"));
			expect(res.status).toBe(200);
			expect(await res.text()).toBe("OK");
		});

		it("should support CIDR ranges in blacklist", async () => {
			// IP within blocked range
			app.use(setClientIp("192.168.1.50"));
			app.use(
				ipRestriction({
					mode: "blacklist",
					ips: ["192.168.1.0/24"],
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			const res1 = await app.handle(new Request("http://localhost/"));
			expect(res1.status).toBe(403);

			// IP outside blocked range
			app = new Web();
			app.use(setClientIp("192.168.2.1"));
			app.use(
				ipRestriction({
					mode: "blacklist",
					ips: ["192.168.1.0/24"],
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			const res2 = await app.handle(new Request("http://localhost/"));
			expect(res2.status).toBe(200);
		});
	});

	describe("IPv6 Support", () => {
		it("should support IPv6 addresses", async () => {
			// Allowed IPv6
			app.use(setClientIp("::1"));
			app.use(
				ipRestriction({
					mode: "whitelist",
					ips: ["::1", "2001:db8::1"],
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			const res1 = await app.handle(new Request("http://localhost/"));
			expect(res1.status).toBe(200);

			// Another allowed IPv6
			app = new Web();
			app.use(setClientIp("2001:db8::1"));
			app.use(
				ipRestriction({
					mode: "whitelist",
					ips: ["::1", "2001:db8::1"],
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			const res2 = await app.handle(new Request("http://localhost/"));
			expect(res2.status).toBe(200);

			// Blocked IPv6
			app = new Web();
			app.use(setClientIp("2001:db8::2"));
			app.use(
				ipRestriction({
					mode: "whitelist",
					ips: ["::1", "2001:db8::1"],
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			const res3 = await app.handle(new Request("http://localhost/"));
			expect(res3.status).toBe(403);
		});

		it("should support IPv6 CIDR ranges", async () => {
			// IP within range
			app.use(setClientIp("2001:db8:85a3::8a2e:370:7334"));
			app.use(
				ipRestriction({
					mode: "whitelist",
					ips: ["2001:db8::/32"],
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			const res1 = await app.handle(new Request("http://localhost/"));
			expect(res1.status).toBe(200);

			// IP outside range
			app = new Web();
			app.use(setClientIp("2001:db9::1"));
			app.use(
				ipRestriction({
					mode: "whitelist",
					ips: ["2001:db8::/32"],
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			const res2 = await app.handle(new Request("http://localhost/"));
			expect(res2.status).toBe(403);
		});

		it("should handle IPv4-mapped IPv6 addresses", async () => {
			app.use(setClientIp("::ffff:192.168.1.1"));
			app.use(
				ipRestriction({
					mode: "whitelist",
					ips: ["192.168.1.1"],
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			const res = await app.handle(new Request("http://localhost/"));
			expect(res.status).toBe(200);
		});
	});

	describe("Custom Messages", () => {
		it("should support static custom messages", async () => {
			app.use(setClientIp("192.168.1.100"));
			app.use(
				ipRestriction({
					mode: "blacklist",
					ips: ["192.168.1.100"],
					message: "Your IP is banned",
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			const res = await app.handle(new Request("http://localhost/"));
			expect(res.status).toBe(403);
			expect(await res.text()).toBe("Your IP is banned");
		});

		it("should support dynamic custom messages", async () => {
			app.use(setClientIp("192.168.1.100"));
			app.use(
				ipRestriction({
					mode: "blacklist",
					ips: ["192.168.1.100"],
					message: (ip) => `IP ${ip} is not allowed`,
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			const res = await app.handle(new Request("http://localhost/"));
			expect(res.status).toBe(403);
			expect(await res.text()).toBe("IP 192.168.1.100 is not allowed");
		});

		it("should use custom status code", async () => {
			app.use(setClientIp("192.168.1.100"));
			app.use(
				ipRestriction({
					mode: "blacklist",
					ips: ["192.168.1.100"],
					statusCode: 401,
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			const res = await app.handle(new Request("http://localhost/"));
			expect(res.status).toBe(401);
		});
	});

	describe("Skip Functionality", () => {
		it("should skip restriction when skip function returns true", async () => {
			app.use(setClientIp("192.168.1.100"));
			app.use(
				ipRestriction({
					mode: "blacklist",
					ips: ["192.168.1.100"],
					skip: (ctx) => ctx.req.headers.get("x-admin") === "true",
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			// Normal request - blocked
			const res1 = await app.handle(new Request("http://localhost/"));
			expect(res1.status).toBe(403);

			// Admin request - allowed
			const adminReq = new Request("http://localhost/", {
				headers: { "x-admin": "true" },
			});
			const res2 = await app.handle(adminReq);
			expect(res2.status).toBe(200);
		});

		it("should support async skip function", async () => {
			app.use(setClientIp("192.168.1.100"));
			app.use(
				ipRestriction({
					mode: "blacklist",
					ips: ["192.168.1.100"],
					skip: async (ctx) => {
						// Simulate async check
						await new Promise((resolve) => setTimeout(resolve, 10));
						return ctx.req.headers.get("x-admin") === "true";
					},
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			const adminReq = new Request("http://localhost/", {
				headers: { "x-admin": "true" },
			});
			const res = await app.handle(adminReq);
			expect(res.status).toBe(200);
		});
	});

	describe("Debug Headers", () => {
		it("should set debug header when enabled", async () => {
			// Test allowed IP
			app.use(setClientIp("192.168.1.100"));
			app.use(
				ipRestriction({
					mode: "whitelist",
					ips: ["192.168.1.100"],
					setHeader: true,
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			const res1 = await app.handle(new Request("http://localhost/"));
			expect(res1.headers.get("x-ip-restriction")).toBe("allowed");

			// Test blocked IP
			app = new Web();
			app.use(setClientIp("192.168.1.101"));
			app.use(
				ipRestriction({
					mode: "whitelist",
					ips: ["192.168.1.100"],
					setHeader: true,
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			const res2 = await app.handle(new Request("http://localhost/"));
			expect(res2.headers.get("x-ip-restriction")).toBe("denied");
		});

		it("should use custom header name", async () => {
			app.use(setClientIp("192.168.1.100"));
			app.use(
				ipRestriction({
					mode: "whitelist",
					ips: ["192.168.1.100"],
					setHeader: true,
					headerName: "X-Access-Status",
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			const res = await app.handle(new Request("http://localhost/"));
			expect(res.headers.get("x-access-status")).toBe("allowed");
		});
	});

	describe("Logging", () => {
		it("should log denied requests when enabled", async () => {
			const logs: string[] = [];

			app.use(setClientIp("192.168.1.100"));
			app.use(
				ipRestriction({
					mode: "blacklist",
					ips: ["192.168.1.100"],
					logDenied: true,
					logger: (message) => logs.push(message),
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			await app.handle(new Request("http://localhost/"));

			expect(logs).toHaveLength(1);
			expect(logs[0]).toContain("192.168.1.100 in blacklist");
		});

		it("should not log when logging is disabled", async () => {
			const logs: string[] = [];

			app.use(setClientIp("192.168.1.100"));
			app.use(
				ipRestriction({
					mode: "blacklist",
					ips: ["192.168.1.100"],
					logDenied: false,
					logger: (message) => logs.push(message),
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			await app.handle(new Request("http://localhost/"));

			expect(logs).toHaveLength(0);
		});
	});

	describe("Edge Cases", () => {
		it("should handle missing client IP", async () => {
			// Don't set client IP
			app.use(
				ipRestriction({
					mode: "whitelist",
					ips: ["192.168.1.100"],
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			const res = await app.handle(new Request("http://localhost/"));

			expect(res.status).toBe(403);
			expect(await res.text()).toBe("Access denied");
		});

		it("should handle empty IP list", async () => {
			app.use(setClientIp("192.168.1.100"));
			app.use(
				ipRestriction({
					mode: "whitelist",
					ips: [],
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			// All IPs should be blocked with empty whitelist
			const res = await app.handle(new Request("http://localhost/"));
			expect(res.status).toBe(403);
		});

		it("should normalize various IP formats", async () => {
			// IP with port (should be normalized)
			app.use(setClientIp("192.168.1.1:8080"));
			app.use(
				ipRestriction({
					mode: "whitelist",
					ips: ["192.168.1.1"],
				})
			);
			app.get("/", (ctx) => ctx.text("OK"));

			const res = await app.handle(new Request("http://localhost/"));
			expect(res.status).toBe(200);
		});
	});

	describe("Presets", () => {
		it("should work with localhost preset", async () => {
			const preset = ipRestrictionPresets.localhostOnly();

			// Localhost IPv4
			app.use(setClientIp("127.0.0.1"));
			app.use(ipRestriction(preset));
			app.get("/", (ctx) => ctx.text("OK"));

			const res1 = await app.handle(new Request("http://localhost/"));
			expect(res1.status).toBe(200);

			// Localhost IPv6
			app = new Web();
			app.use(setClientIp("::1"));
			app.use(ipRestriction(preset));
			app.get("/", (ctx) => ctx.text("OK"));

			const res2 = await app.handle(new Request("http://localhost/"));
			expect(res2.status).toBe(200);

			// Non-localhost
			app = new Web();
			app.use(setClientIp("192.168.1.1"));
			app.use(ipRestriction(preset));
			app.get("/", (ctx) => ctx.text("OK"));

			const res3 = await app.handle(new Request("http://localhost/"));
			expect(res3.status).toBe(403);
		});

		it("should work with private network preset", async () => {
			const preset = ipRestrictionPresets.privateNetworkOnly();

			// Test various private IPs
			const privateIps = ["10.0.0.1", "172.16.0.1", "192.168.1.1"];

			for (const ip of privateIps) {
				app = new Web();
				app.use(setClientIp(ip));
				app.use(ipRestriction(preset));
				app.get("/", (ctx) => ctx.text("OK"));

				const res = await app.handle(new Request("http://localhost/"));
				expect(res.status).toBe(200);
			}

			// Public IP
			app = new Web();
			app.use(setClientIp("8.8.8.8"));
			app.use(ipRestriction(preset));
			app.get("/", (ctx) => ctx.text("OK"));

			const res = await app.handle(new Request("http://localhost/"));
			expect(res.status).toBe(403);
		});
	});

	describe("Dynamic IP Restriction", () => {
		it("should allow adding IPs dynamically", async () => {
			const restriction = createDynamicIpRestriction({
				mode: "blacklist",
				ips: [],
			});

			app.use(setClientIp("192.168.1.100"));
			app.use(restriction.middleware);
			app.get("/", (ctx) => ctx.text("OK"));

			// Initially allowed
			const res1 = await app.handle(new Request("http://localhost/"));
			expect(res1.status).toBe(200);

			// Add IP to blacklist
			restriction.addIp("192.168.1.100");

			// Now blocked
			const res2 = await app.handle(new Request("http://localhost/"));
			expect(res2.status).toBe(403);
		});

		it("should allow removing IPs dynamically", async () => {
			const restriction = createDynamicIpRestriction({
				mode: "blacklist",
				ips: ["192.168.1.100"],
			});

			app.use(setClientIp("192.168.1.100"));
			app.use(restriction.middleware);
			app.get("/", (ctx) => ctx.text("OK"));

			// Initially blocked
			const res1 = await app.handle(new Request("http://localhost/"));
			expect(res1.status).toBe(403);

			// Remove IP from blacklist
			restriction.removeIp("192.168.1.100");

			// Now allowed
			const res2 = await app.handle(new Request("http://localhost/"));
			expect(res2.status).toBe(200);
		});

		it("should allow updating config dynamically", async () => {
			const restriction = createDynamicIpRestriction({
				mode: "whitelist",
				ips: ["192.168.1.100"],
			});

			// Test with IP not in whitelist
			app.use(setClientIp("192.168.1.101"));
			app.use(restriction.middleware);
			app.get("/", (ctx) => ctx.text("OK"));

			// Initially blocked
			const res1 = await app.handle(new Request("http://localhost/"));
			expect(res1.status).toBe(403);

			// Update to blacklist mode
			restriction.update({
				mode: "blacklist",
				ips: ["192.168.1.102"],
			});

			// Now 192.168.1.101 should be allowed
			const res2 = await app.handle(new Request("http://localhost/"));
			expect(res2.status).toBe(200);

			// Test with blocked IP
			app = new Web();
			app.use(setClientIp("192.168.1.102"));
			app.use(restriction.middleware);
			app.get("/", (ctx) => ctx.text("OK"));

			const res3 = await app.handle(new Request("http://localhost/"));
			expect(res3.status).toBe(403);
		});

		it("should return current config", async () => {
			const restriction = createDynamicIpRestriction({
				mode: "whitelist",
				ips: ["192.168.1.100"],
				message: "Test message",
			});

			const config = restriction.getConfig();
			expect(config.mode).toBe("whitelist");
			expect(config.ips).toEqual(["192.168.1.100"]);
			expect(config.message).toBe("Test message");
		});
	});
});
