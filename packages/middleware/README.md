# 🚀 @rabbit-company/web-middleware

[![NPM Version](https://img.shields.io/npm/v/@rabbit-company/web-middleware)](https://www.npmjs.com/package/web-middleware)
[![JSR Version](https://jsr.io/badges/@rabbit-company/web-middleware)](https://jsr.io/@rabbit-company/web-middleware)
[![License](https://img.shields.io/npm/l/@rabbit-company/web-middleware)](LICENSE)

## 📦 Installation

```bash
# npm
npm install @rabbit-company/web-middleware

# pnpm
pnpm add @rabbit-company/web-middleware

# bun
bun add @rabbit-company/web-middleware

# Deno (via JSR)
deno add @rabbit-company/web-middleware
```

## 🎯 Quick Start

```js
import { Web } from "@rabbit-company/web";
import { bearerAuth } from "@rabbit-company/web-middleware/basic-auth";
import { cors } from "@rabbit-company/web-middleware/cors";
import { logger } from "@rabbit-company/web-middleware/logger";
import { rateLimit } from "@rabbit-company/web-middleware/rate-limit";

const app = new Web();

// Enable request/response logging
app.use(
	logger({
		preset: "standard", // Use predefined configuration
		excludePaths: ["/health", "/ping"], // Skip logging for these paths
	})
);

// Enable CORS
app.use(
	cors({
		origin: ["https://example.com", "https://app.example.com"],
		credentials: true,
	})
);

// Add rate limiting
app.use(
	rateLimit({
		windowMs: 15 * 60 * 1000, // 15 minutes
		max: 100, // limit each IP to 100 requests per windowMs
	})
);

// Protect API routes with bearer auth
app.use(
	"/api",
	bearerAuth({
		validate: async (token) => {
			// Your token validation logic
			return token === "valid-token" ? { id: "user123" } : false;
		},
	})
);

app.get("/api/profile", (ctx) => {
	const user = ctx.get("user");
	return ctx.json({ user });
});

// Start server
app.listen({ port: 3000 });

console.log("Server running at http://localhost:3000");
```

## 🧩 Available Middleware

### 🔐 Authentication

- [**Bearer Auth**](#bearer-auth) - JWT/API token authentication
- [**Basic Auth**](#basic-auth) - HTTP Basic authentication

### 🛡️ Security

- [**CORS**](#cors) - Cross-Origin Resource Sharing
- [**Rate Limit**](#rate-limit) - Request rate limiting with multiple algorithms
- [**IP Restriction**](#ip-restriction) - Limits access to resources based on the IP address

### 📊 Utils

- [**Logger**](#logger) - HTTP request/response logging with customizable formats
- [**Body Limit**](#body-limit) - Limit the file size of the request body
- [**Cache**](#cache) - Response caching using pluggable backends like in-memory, LRU, or Redis for improved performance and reduced server load
- [**IP Extract**](#ip-extract) - Parses the incoming request's IP address, respecting common proxy headers (X-Forwarded-For, X-Real-IP) and attaches it to the request context

## 📚 Middleware Documentation

### Logger

Comprehensive HTTP request/response logging middleware using @rabbit-company/logger.

```js
import { logger } from "@rabbit-company/web-middleware/logger";

// Minimal logging (clean output)
app.use(logger({ preset: "minimal" }));
// Output: GET /api/users 200 45ms

// Standard logging (with request IDs)
app.use(logger({ preset: "standard" }));

// Detailed logging (includes headers and IPs)
app.use(logger({ preset: "detailed" }));

// Debug logging (everything including request/response bodies)
app.use(logger({ preset: "debug" }));

// Custom configuration
app.use(
	logger({
		level: Levels.INFO,
		logRequestBody: true,
		logResponseBody: false,
		maxBodyLength: 5000,
		excludeHeaders: ["authorization", "cookie"],
		excludePaths: ["/health", "/metrics", /^\/static/],
		includeUserAgent: true,
		includeRemoteAddress: true,
		getUserId: (ctx) => ctx.get("user")?.id,
		metadata: { service: "api", version: "1.0.0" },
	})
);

// Custom formatting
app.use(
	logger({
		formatRequestMessage: (ctx, requestId) => {
			const url = new URL(ctx.req.url);
			return `→ [${requestId}] ${ctx.req.method} ${url.pathname}`;
		},
		formatResponseMessage: (ctx, requestId, duration, statusCode) => {
			const url = new URL(ctx.req.url);
			return `← [${requestId}] ${statusCode} ${duration}ms`;
		},
	})
);
```

#### Options:

- `preset`: Pre-configured logging setup ("minimal", "standard", "detailed", "debug")
- `level`: Log level from @rabbit-company/logger (ERROR, WARN, AUDIT, INFO, HTTP, DEBUG, VERBOSE, SILLY)
- `logger`: Custom logger instance
- `includeRequestId`: Add unique request ID to logs (default: true)
- `includeTimestamp`: Add timestamp to logs (default: true)
- `includeMethod`: Include HTTP method (default: true)
- `includePath`: Include request path (default: true)
- `includeStatusCode`: Include response status (default: true)
- `includeDuration`: Log request duration (default: true)
- `includeIp`: Include client IP address (default: varies by preset)
- `includeUserAgent`: Include User-Agent header (default: varies by preset)
- `includeHeaders`: Log request/response headers (default: false)
- `excludeHeaders`: Headers to exclude from logging (default: ["authorization", "cookie"])
- `logRequestBody`: Log request body (default: false)
- `logResponseBody`: Log response body (default: false)
- `maxBodyLength`: Maximum body length to log (default: 10000)
- `excludePaths`: Paths/patterns to skip logging (string or RegExp array)
- `skip`: Function to conditionally skip logging
- `getUserId`: Extract user ID from context for logging
- `metadata`: Additional metadata to include in all logs
- `formatRequestMessage`: Custom request log format function
- `formatResponseMessage`: Custom response log format function
- `formatErrorMessage`: Custom error log format function
- `onLog`: Callback function called after logging

### Cache

High-performance HTTP caching middleware with support for multiple storage backends, conditional requests, and stale-while-revalidate.

```js
import { cache, MemoryCache, LRUCache, RedisCache } from "@rabbit-company/web-middleware/cache";

// Basic in-memory caching
app.use(cache());

// LRU cache with max 500 entries
app.use(
	cache({
		storage: new LRUCache(500),
		ttl: 600, // 10 minutes
		hashAlgorithm: "md5", // Faster hash algorithm for ETag generation
	})
);

// Redis cache for distributed caching
import Redis from "ioredis";
const redis = new Redis();

app.use(
	cache({
		storage: new RedisCache(redis),
		ttl: 3600, // 1 hour
		staleWhileRevalidate: true,
		maxStaleAge: 86400, // 24 hours
	})
);

// Advanced configuration
app.use(
	cache({
		storage: new MemoryCache(),
		ttl: 300, // 5 minutes default
		methods: ["GET", "HEAD"], // Only cache GET/HEAD requests

		// Custom cache key generation
		keyGenerator: (ctx) => {
			const url = new URL(ctx.req.url);
			const userId = ctx.get("user")?.id || "anonymous";
			return `${ctx.req.method}:${url.pathname}:${userId}`;
		},

		// Conditional caching
		shouldCache: (ctx, res) => {
			// Only cache successful responses
			if (res.status < 200 || res.status >= 300) return false;

			// Don't cache if response is too large
			const size = res.headers.get("content-length");
			if (size && parseInt(size) > 1024 * 1024) return false; // 1MB limit

			return true;
		},

		// Vary cache by headers
		varyHeaders: ["accept", "accept-encoding", "accept-language"],

		// Respect Cache-Control headers
		respectCacheControl: true,

		// Path filtering
		excludePaths: ["/api/auth", "/api/admin", /^\/ws/],
		includePaths: ["/api/public", "/api/products"],
	})
);

// Conditional requests (ETag support)
app.get("/api/data", cache({ ttl: 3600 }), async (ctx) => {
	const data = await getExpensiveData();
	return ctx.json(data);
	// Middleware automatically generates ETag and handles If-None-Match
});

// Stale-while-revalidate pattern
app.use(
	cache({
		ttl: 60, // Fresh for 1 minute
		staleWhileRevalidate: true,
		maxStaleAge: 3600, // Serve stale for up to 1 hour while revalidating
	})
);

// Cache invalidation
import { cacheUtils } from "@rabbit-company/web-middleware";

// Invalidate specific cache keys
app.post(
	"/api/posts",
	createPost,
	cacheUtils.invalidate({
		storage: cache.storage,
		keys: ["GET:/api/posts", "GET:/api/posts/latest"],
	})
);

// Pattern-based invalidation (Redis only)
app.put(
	"/api/posts/:id",
	updatePost,
	cacheUtils.invalidate({
		storage: redisCache,
		patterns: ["GET:/api/posts/*", "GET:/api/users/*/posts"],
	})
);

// Clear entire cache
await cacheUtils.clear(cache.storage);

// Get cache statistics
const stats = await cacheUtils.stats(cache.storage);
console.log(`Cache size: ${stats.size} entries`);

// Custom storage implementation
class CustomStorage {
	async get(key) {
		/* ... */
	}
	async set(key, entry, ttl, maxStaleAge) {
		/* ... */
	}
	async delete(key) {
		/* ... */
	}
	async clear() {
		/* ... */
	}
	async has(key) {
		/* ... */
	}
	async size() {
		/* ... */
	}
}

app.use(cache({ storage: new CustomStorage() }));
```

#### Storage Backends:

- **MemoryCache**: In-memory storage with automatic expiry
- **LRUCache**: Least Recently Used eviction when size limit reached
- **RedisCache**: Distributed caching with Redis

#### Options:

- `storage`: Cache storage backend (default: MemoryCache)
- `ttl`: Time to live in seconds (default: 300)
- `methods`: HTTP methods to cache (default: ["GET", "HEAD"])
- `keyGenerator`: Custom cache key generation function
- `shouldCache`: Function to determine if response should be cached
- `varyHeaders`: Headers to include in cache key (default: ["accept", "accept-encoding"])
- `respectCacheControl`: Honor Cache-Control headers (default: true)
- `addCacheHeader`: Add X-Cache-Status header (default: true)
- `cacheHeaderName`: Custom cache status header name (default: "x-cache-status")
- `cachePrivate`: Cache private responses (default: false)
- `excludePaths`: Paths to exclude from caching
- `includePaths`: Only cache these paths (if set)
- `staleWhileRevalidate`: Serve stale content while revalidating (default: false)
- `maxStaleAge`: Maximum stale age in seconds (default: 86400)
- `hashAlgorithm`: Hash algorithm to use for ETag generation (default: blake2b512)
- `generateETags`: Whether to generate ETags for responses (default: true)
- `shouldGenerateETag`: Function to determine if ETag should be generated for a specific response (default: Smart function that skips large files and certain content types)
- `maxETagBodySize`: Maximum body size in bytes for ETag generation (default: 1048576)
- `skipETagContentTypes`: Content types to skip ETag generation for (default: ['image/', 'video/', 'audio/', 'application/octet-stream', 'application/zip', 'application/pdf'])

#### Features:

- Automatic ETag generation and conditional request handling
- Stale-while-revalidate for better performance
- Cache-Control header support
- Vary header support for content negotiation
- Pattern-based invalidation with Redis
- Background revalidation for stale content
- Distributed caching with Redis backend
- Memory efficient with configurable storage limits

### Body Limit

Protect your server from large request payloads with configurable size limits. Prevents memory exhaustion and ensures fair resource usage.

```js
import { bodyLimit } from "@rabbit-company/web-middleware/body-limit";

// Basic usage - 1MB limit (default)
app.use(bodyLimit());

// Custom size limit
app.use(
	bodyLimit({
		maxSize: "5mb", // or 5242880 for bytes
	})
);

// Different limits for different routes
app.post("/api/upload/avatar", bodyLimit({ maxSize: "2mb" }), uploadAvatar);

app.post("/api/upload/video", bodyLimit({ maxSize: "100mb" }), uploadVideo);

// Limit only specific content types
app.use(
	bodyLimit({
		maxSize: "10mb",
		contentTypes: ["application/json", "application/xml"],
		message: "JSON/XML payload too large",
	})
);

// Skip limit for premium users
app.use(
	bodyLimit({
		maxSize: "5mb",
		skip: async (ctx) => {
			const user = ctx.get("user");
			return user?.plan === "premium";
		},
	})
);

// Custom error handling
app.use(
	bodyLimit({
		maxSize: "1mb",
		message: (size, limit) => `Payload too large: ${(size / 1024).toFixed(2)}KB exceeds ${(limit / 1024).toFixed(2)}KB limit`,
		statusCode: 400, // Use 400 instead of default 413
	})
);

// Include headers in size calculation
app.use(
	bodyLimit({
		maxSize: "10kb",
		includeHeaders: true, // Total request size including headers
	})
);

// File upload endpoint with strict limit
app.post(
	"/api/documents",
	bodyLimit({
		maxSize: "10mb",
		contentTypes: ["multipart/form-data"],
		message: "Document size must not exceed 10MB",
	}),
	async (ctx) => {
		const formData = await ctx.req.formData();
		const file = formData.get("document");
		// Process file...
		return ctx.json({ success: true });
	}
);
```

#### Options:

- `maxSize`: Maximum allowed body size (number in bytes or string with units: "1kb", "5mb", "1gb")
- `includeHeaders`: Include header size in limit calculation (default: false)
- `message`: Error message - string or function(size, limit)
- `statusCode`: HTTP status code when limit exceeded (default: 413)
- `contentTypes`: Array of content types to apply limit to (default: all)
- `skip`: Function to conditionally skip limit check

#### Size Format Examples:

- `100` or `"100"` - 100 bytes
- `"100b"` - 100 bytes
- `"10kb"` - 10 kilobytes (10,240 bytes)
- `"5.5mb"` - 5.5 megabytes
- `"1gb"` - 1 gigabyte

#### Security Benefits:

- Prevents memory exhaustion attacks
- Protects against slowloris-style attacks
- Ensures fair resource allocation
- Reduces attack surface for buffer overflow exploits

#### Performance Notes:

- Uses Content-Length header for efficient early rejection
- No body parsing required - fails fast for oversized requests
- Minimal memory overhead
- Works with streaming and non-streaming requests

### Bearer Auth

Token-based authentication for APIs.

```js
import { bearerAuth } from "@rabbit-company/web-middleware/bearer-auth";

// Simple API key validation
app.use(
	bearerAuth({
		validate: (token) => token === "secret-api-key",
	})
);

// JWT validation with user data
app.use(
	bearerAuth({
		validate: async (token, ctx) => {
			try {
				const payload = jwt.verify(token, JWT_SECRET);
				// Return user data to be stored in context
				return {
					id: payload.sub,
					email: payload.email,
					permissions: payload.permissions,
				};
			} catch {
				return false; // Invalid token
			}
		},
		contextKey: "currentUser", // Access via ctx.get("currentUser")
		invalidTokenMessage: "Token expired or invalid",
	})
);

// Database token validation with rate limiting
app.use(
	bearerAuth({
		validate: async (token, ctx) => {
			const apiKey = await db.apiKeys.findOne({
				token,
				active: true,
				expiresAt: { $gt: new Date() },
			});

			if (!apiKey) return false;

			// Log API usage
			await db.apiUsage.create({
				apiKeyId: apiKey.id,
				endpoint: ctx.req.url,
				timestamp: new Date(),
			});

			return {
				userId: apiKey.userId,
				permissions: apiKey.permissions,
				rateLimit: apiKey.rateLimit,
			};
		},
		realm: "API",
		missingTokenMessage: "API key required",
		invalidTokenMessage: "Invalid or expired API key",
	})
);

// Protected route example
app.get("/api/profile", bearerAuth({ validate }), (ctx) => {
	const user = ctx.get("user");
	return ctx.json({
		id: user.id,
		email: user.email,
	});
});
```

#### Options:

- `validate`: Function to verify token validity (required)
- `scheme`: Authentication scheme for WWW-Authenticate header (default: "Bearer")
- `realm`: Optional realm for WWW-Authenticate header
- `contextKey`: Where to store user data in context (default: "user")
- `missingTokenMessage`: Error when token is missing
- `invalidTokenMessage`: Error when token is invalid
- `skip`: Function to conditionally skip authentication

### Basic Auth

HTTP Basic Authentication for simple username/password protection. Automatically handles base64 decoding and credential parsing.

```js
import { basicAuth } from "@rabbit-company/web-middleware/basic-auth";

// Simple validation
app.use(
	basicAuth({
		validate: async (username, password) => {
			return username === "admin" && password === "secret";
		},
		realm: "Admin Panel",
	})
);

// Database validation with bcrypt
app.use(
	basicAuth({
		validate: async (username, password, ctx) => {
			const user = await db.users.findOne({ username });
			if (!user) return false;

			const validPassword = await bcrypt.compare(password, user.passwordHash);
			if (!validPassword) return false;

			// Store user info in context
			ctx.set("user", {
				id: user.id,
				username: user.username,
				role: user.role,
			});

			return true;
		},
		realm: "Restricted Area",
		contextKey: "authenticatedUser",
	})
);

// Environment-based credentials
app.use(
	"/admin",
	basicAuth({
		validate: (username, password) => {
			const validUsers = {
				[process.env.ADMIN_USER]: process.env.ADMIN_PASS,
				[process.env.SUPPORT_USER]: process.env.SUPPORT_PASS,
			};

			return validUsers[username] === password;
		},
		realm: "Administration",
	})
);

// Role-based access
const adminAuth = basicAuth({
	validate: async (username, password, ctx) => {
		if (username === "admin" && password === process.env.ADMIN_PASSWORD) {
			ctx.set("user", { username, role: "admin" });
			return true;
		}
		if (username === "viewer" && password === process.env.VIEWER_PASSWORD) {
			ctx.set("user", { username, role: "viewer" });
			return true;
		}
		return false;
	},
});

app.use("/admin", adminAuth, async (ctx, next) => {
	const user = ctx.get("user");
	if (user.role !== "admin") {
		return ctx.text("Admin access required", 403);
	}
	return next();
});
```

#### Options:

- `validate`: Function to verify credentials (required)
- `realm`: Authentication realm shown in browser popup (default: "Restricted")
- `contextKey`: Where to store user data in context (default: "user")
- `skip`: Function to conditionally skip authentication

#### Security Notes:

- Always use HTTPS in production to protect credentials
- Consider using Bearer Auth for API endpoints
- Store passwords hashed (bcrypt, argon2) never in plain text
- Basic Auth credentials are sent with every request

### CORS

Configure Cross-Origin Resource Sharing.

```js
import { cors } from "@rabbit-company/web-middleware/cors";

app.use(
	cors({
		origin: ["https://example.com", "https://app.example.com"],
		credentials: true,
		allowMethods: ["GET", "POST", "PUT", "DELETE"],
		allowHeaders: ["Content-Type", "Authorization"],
		exposeHeaders: ["X-Total-Count"],
		maxAge: 86400, // 24 hours
	})
);

// Dynamic origin validation
app.use(
	cors({
		origin: (origin) => {
			return origin.endsWith(".example.com");
		},
	})
);
```

#### Options:

- `origin`: Allowed origins (string, array, or validation function)
- `allowMethods`: HTTP methods to allow (default: common methods)
- `allowHeaders`: Headers that can be sent by the client
- `exposeHeaders`: Headers exposed to the client's JavaScript
- `credentials`: Allow cookies/auth (requires specific origin, not \*)
- `maxAge`: Preflight cache duration in seconds
- `preflightContinue`: Pass OPTIONS requests to next handler
- `optionsSuccessStatus`: Status code for successful OPTIONS

### Rate Limit

Advanced rate limiting with multiple algorithms to prevent API abuse and ensure fair usage..

```js
import { rateLimit, Algorithm, createRateLimiter } from "@rabbit-company/web-middleware/rate-limit";

// Basic rate limiting - Fixed Window (default)
app.use(
	rateLimit({
		windowMs: 15 * 60 * 1000, // 15 minutes
		max: 100, // 100 requests per window
		message: "Too many requests, please try again later.",
		headers: true, // Include rate limit headers in response
	})
);

// Sliding Window - More accurate, prevents bursts at window boundaries
app.use(
	rateLimit({
		algorithm: Algorithm.SLIDING_WINDOW,
		windowMs: 60 * 1000, // 1 minute
		max: 60, // 60 requests per minute
		precision: 100, // 100ms precision for accuracy
		headers: true,
	})
);

// Token Bucket - Allows controlled bursts
app.use(
	rateLimit({
		algorithm: Algorithm.TOKEN_BUCKET,
		max: 20, // Bucket capacity (burst size)
		refillRate: 5, // Add 5 tokens per interval
		refillInterval: 1000, // Refill every second (5 req/sec sustained)
	})
);

// Different limits for different endpoints
app.post(
	"/api/login",
	rateLimit({
		windowMs: 15 * 60 * 1000, // 15 minutes
		max: 5, // Only 5 login attempts
		message: "Too many login attempts, please try again later",
		keyGenerator: (ctx) => {
			// Rate limit by IP + username combo
			const username = ctx.req.body?.username || "anonymous";
			const ip = ctx.req.headers.get("x-forwarded-for") || "unknown";
			return `${ip}:${username}`;
		},
	})
);

// Shared rate limiter across routes
const apiLimiter = createRateLimiter({
	algorithm: Algorithm.SLIDING_WINDOW,
	window: 60 * 1000,
	max: 100,
});

app.use("/api/users", rateLimit({ rateLimiter: apiLimiter }));
app.use("/api/posts", rateLimit({ rateLimiter: apiLimiter }));
app.use("/api/comments", rateLimit({ rateLimiter: apiLimiter }));

// Skip rate limiting for certain users
app.use(
	rateLimit({
		skip: async (ctx) => {
			// Skip for authenticated premium users
			const user = ctx.get("user");
			return user?.tier === "premium";

			// Or skip for internal services
			const apiKey = ctx.req.headers.get("x-api-key");
			return apiKey === process.env.INTERNAL_API_KEY;
		},
	})
);

// Custom key generation strategies
import { createKeyGenerator } from "@rabbit-company/web-middleware";

const keyGen = createKeyGenerator({
	custom: (ctx) => {
		// Add custom identifier
		const apiKey = ctx.req.headers.get("x-api-key");
		return apiKey ? `api:${apiKey}` : null;
	},
});

app.use(
	rateLimit({
		keyGenerator: keyGen,
		max: 1000, // Higher limit for authenticated users
	})
);

// Advanced configuration with cleanup
app.use(
	rateLimit({
		algorithm: Algorithm.FIXED_WINDOW,
		windowMs: 60 * 1000,
		max: 100,
		headers: true,
		enableCleanup: true, // Auto cleanup expired entries
		cleanupInterval: 30 * 1000, // Run cleanup every 30 seconds
		endpointGenerator: (ctx) => {
			// Group rate limits by REST resource
			const url = new URL(ctx.req.url);
			const parts = url.pathname.split("/");
			return `${ctx.req.method}:/${parts[1]}/${parts[2]}/*`;
		},
	})
);

// Get rate limiter statistics
const limiter = createRateLimiter({ max: 100 });
app.use(rateLimit({ rateLimiter: limiter }));

// Later...
console.log(`Active rate limits: ${limiter.getSize()}`);
```

#### Algorithms:

- **Fixed Window**: Simple, resets at interval boundaries
- **Sliding Window**: More accurate, prevents boundary bursts
- **Token Bucket**: Allows bursts while maintaining average rate

#### Options:

- `algorithm`: Rate limiting algorithm to use
- `windowMs`: Time window for fixed/sliding algorithms
- `max`: Maximum requests per window or bucket capacity
- `refillRate`: Tokens added per interval (token bucket)
- `refillInterval`: How often to add tokens (token bucket)
- `precision`: Sliding window precision in ms
- `message`: Error message when rate limited
- `statusCode`: HTTP status (default: 429)
- `headers`: Include RateLimit-\* headers
- `keyGenerator`: Custom key generation function
- `endpointGenerator`: Group endpoints for shared limits
- `skip`: Conditionally skip rate limiting
- `rateLimiter`: Use shared limiter instance

#### Response Headers:

- `RateLimit-Limit`: Request limit
- `RateLimit-Remaining`: Requests remaining
- `RateLimit-Reset`: Reset timestamp
- `RateLimit-Algorithm`: Algorithm used
- `Retry-After`: Seconds until retry (when limited)

### IP Extract

Securely extract client IP addresses from requests, handling various proxy configurations and preventing IP spoofing attacks.

```js
import { ipExtract, getClientIp } from "@rabbit-company/web-middleware/ip-extract";

// Direct connection (no proxy)
app.use(ipExtract("direct"));

// Behind Cloudflare
app.use(ipExtract("cloudflare"));

// Behind AWS Load Balancer
app.use(ipExtract("aws"));

// Behind nginx reverse proxy
app.use(ipExtract("nginx"));

// Custom configuration
app.use(
	ipExtract({
		trustProxy: true,
		trustedProxies: ["10.0.0.0/8", "172.16.0.0/12"],
		trustedHeaders: ["x-real-ip", "x-forwarded-for"],
		maxProxyChain: 3,
		logWarnings: true,
	})
);

// Access the extracted IP
app.get("/api/info", (ctx) => {
	const ip = getClientIp(ctx);
	// or directly: ctx.clientIp
	return ctx.json({
		clientIp: ip,
		country: geoip.lookup(ip)?.country,
	});
});

// Rate limiting by IP
app.use(ipExtract("cloudflare"));
app.use(
	rateLimit({
		keyGenerator: (ctx) => getClientIp(ctx) || "unknown",
	})
);

// Logging with real IPs
app.use(ipExtract("nginx"));
app.use(
	logger({
		getUserId: (ctx) => getClientIp(ctx),
	})
);

// IP-based access control
const ipWhitelist = ["192.168.1.0/24", "10.0.0.0/8"];

app.use("/admin", ipExtract("direct"), (ctx, next) => {
	const ip = getClientIp(ctx);
	if (!ip || !isIpInWhitelist(ip, ipWhitelist)) {
		return ctx.text("Access denied", 403);
	}
	return next();
});

// Development mode (trusts all headers - NOT for production!)
if (process.env.NODE_ENV === "development") {
	app.use(ipExtract("development"));
}
```

#### Presets:

- `"direct"` - No proxy, direct connections only
- `"cloudflare"` - Behind Cloudflare (auto-configures CF IPs)
- `"aws"` - Behind AWS ALB/ELB
- `"gcp"` - Behind Google Cloud Load Balancer
- `"azure"` - Behind Azure Application Gateway
- `"vercel"` - Behind Vercel's edge network
- `"nginx"` - Behind nginx reverse proxy
- `"development"` - Trusts all headers (NEVER use in production!)

#### Options:

- `trustProxy`: Enable proxy header parsing (default: false)
- `trustedProxies`: List of trusted proxy IPs/CIDR ranges
- `trustedHeaders`: Headers to check in order (default: ["x-forwarded-for", "x-real-ip"])
- `maxProxyChain`: Maximum proxy chain length to prevent attacks (default: 5)
- `cloudProvider`: Auto-configure for cloud provider ("aws", "cloudflare", "gcp", "azure", "vercel")
- `logWarnings`: Log suspicious activity (default: false)

#### Security Features:

- **IP Spoofing Prevention**: Only trusts headers from configured proxies
- **Chain Length Limits**: Prevents long X-Forwarded-For chains
- **CIDR Support**: Configure trusted proxy ranges (e.g., "10.0.0.0/8")
- **Cloud Provider Detection**: Pre-configured secure settings for major providers
- **IPv4/IPv6 Support**: Full support for both protocols

#### Important Notes:

- Always use HTTPS in production to prevent header injection
- Configure `trustedProxies` to match your infrastructure
- The `development` preset is insecure - only for local testing
- Test your configuration with tools like `curl -H "X-Forwarded-For: fake"`
- Consider using cloud provider presets for automatic secure configuration

### IP Restriction

Control access to your application by allowing or blocking specific IP addresses and CIDR ranges. Supports both whitelist and blacklist modes with IPv4/IPv6.

```js
import { ipRestriction, ipRestrictionPresets, createDynamicIpRestriction } from "@rabbit-company/web-middleware/ip-restriction";

// Whitelist mode - only allow specific IPs
app.use(ipRestriction({
  mode: "whitelist",
  ips: ["192.168.1.0/24", "10.0.0.1", "::1"],
  message: "Access restricted to internal network"
}));

// Blacklist mode - block specific IPs
app.use(ipRestriction({
  mode: "blacklist",
  ips: ["192.168.1.100", "10.0.0.0/16"],
  logDenied: true,
  logger: (message, ip) => console.log(`Blocked: ${ip}`)
}));

// Use presets for common scenarios
app.use(ipRestriction(ipRestrictionPresets.localhostOnly()));
app.use(ipRestriction(ipRestrictionPresets.privateNetworkOnly()));

// Behind a proxy? Use with ipExtract
app.use(ipExtract("cloudflare"));
app.use(ipRestriction({
  mode: "whitelist",
  ips: ["203.0.113.0/24"]
}));

// Protect admin routes
app.use("/admin", ipRestriction({
  mode: "whitelist",
  ips: ["10.0.0.0/8"],
  message: (ip) => `Access denied for ${ip}. Admin panel is restricted.`,
  statusCode: 401
}));

// Skip restriction for authenticated users
app.use(ipRestriction({
  mode: "blacklist",
  ips: knownBadIps,
  skip: async (ctx) => {
    const user = ctx.get("user");
    return user?.role === "admin" || user?.verified === true;
  }
}));

// Dynamic IP management
const restriction = createDynamicIpRestriction({
  mode: "blacklist",
  ips: [],
  logDenied: true
});

app.use(restriction.middleware);

// Ban IPs dynamically
app.post("/api/security/ban", async (ctx) => {
  const { ip } = await ctx.req.json();
  restriction.addIp(ip);
  return ctx.json({ banned: ip });
});

// Unban IPs
app.post("/api/security/unban", async (ctx) => {
  const { ip } = await ctx.req.json();
  restriction.removeIp(ip);
  return ctx.json({ unbanned: ip });
});

// Different restrictions for different environments
const ipConfig = process.env.NODE_ENV === "production"
  ? {
      mode: "whitelist" as const,
      ips: ["10.0.0.0/8", "172.16.0.0/12"] // Private networks only
    }
  : ipRestrictionPresets.localhostOnly(); // Dev: localhost only

app.use(ipRestriction(ipConfig));

// Debug headers for testing
app.use(ipRestriction({
  mode: "whitelist",
  ips: ["192.168.1.0/24"],
  setHeader: true,
  headerName: "X-IP-Status" // Response will include X-IP-Status: allowed/denied
}));

// Complex CIDR ranges with IPv6
app.use(ipRestriction({
  mode: "whitelist",
  ips: [
    // IPv4 ranges
    "10.0.0.0/8",       // Private network class A
    "172.16.0.0/12",    // Private network class B
    "192.168.0.0/16",   // Private network class C

    // IPv6 ranges
    "::1/128",          // Localhost
    "fc00::/7",         // Unique local addresses
    "2001:db8::/32"     // Documentation prefix
  ]
}));
```

#### Options:

- `mode`: Operation mode - "whitelist" (allow only listed) or "blacklist" (block listed)
- `ips`: Array of IP addresses or CIDR ranges (supports IPv4 and IPv6)
- `message`: Custom denial message - string or function(ip)
- `statusCode`: HTTP status when denied (default: 403)
- `skip`: Function to conditionally skip restrictions
- `logDenied`: Log denied requests (default: false)
- `logger`: Custom logging function
- `setHeader`: Add debug header with allow/deny status
- `headerName`: Custom header name (default: "X-IP-Restriction")

#### Presets:

- `localhostOnly()`: Allow only 127.0.0.1 and ::1
- `privateNetworkOnly()`: Allow RFC 1918 private networks

#### Features:

- **CIDR Support**: Use ranges like "192.168.1.0/24" or "2001:db8::/32"
- **IPv4/IPv6**: Full support for both protocols
- **Dynamic Management**: Add/remove IPs at runtime
- **Conditional Bypass**: Skip restrictions for certain users/conditions
- **Debug Headers**: Optional headers for testing restrictions
- **Custom Messages**: Dynamic error messages based on blocked IP

#### Security Notes:

- Always use with `ipExtract` middleware when behind proxies
- For direct connections, `ctx.clientIp` is used automatically
- Test CIDR ranges carefully to avoid blocking legitimate users
- Consider using whitelist mode for sensitive endpoints
- Log denied attempts to monitor potential attacks

## 📦 Dependencies

- `@rabbit-company/web` - Core web framework (peer dependency)
- `@rabbit-company/logger` - Flexible logging library with multiple transports
- `@rabbit-company/rate-limiter` - High-performance rate limiting

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](https://github.com/Rabbit-Company/Web-JS/blob/main/LICENSE) file for details. 🐇💕
