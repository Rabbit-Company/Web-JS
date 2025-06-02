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
import { bearerAuth, cors, logger, rateLimit } from "@rabbit-company/web-middleware";

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
Bun.serve({
	port: 3000,
	fetch: app.handle,
});

console.log("Server running at http://localhost:3000");
```

## 🧩 Available Middleware

### 🔐 Authentication

- **Bearer Auth** - JWT/API token authentication
- **Basic Auth** - HTTP Basic authentication

### 🛡️ Security

- **CORS** - Cross-Origin Resource Sharing
- **Rate Limiting** - Request rate limiting with multiple algorithms

### 📊 Utils

- **Logger** - HTTP request/response logging with customizable formats

## 📚 Middleware Documentation

### Logger

Comprehensive HTTP request/response logging middleware using @rabbit-company/logger.

```js
import { logger } from "@rabbit-company/web-middleware";

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
import { cache, MemoryCache, LRUCache, RedisCache } from "@rabbit-company/web-middleware";

// Basic in-memory caching
app.use(cache());

// LRU cache with max 500 entries
app.use(
	cache({
		storage: new LRUCache(500),
		ttl: 600, // 10 minutes
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

#### Features:

- Automatic ETag generation and conditional request handling
- Stale-while-revalidate for better performance
- Cache-Control header support
- Vary header support for content negotiation
- Pattern-based invalidation with Redis
- Background revalidation for stale content
- Distributed caching with Redis backend
- Memory efficient with configurable storage limits

### Bearer Auth

Token-based authentication for APIs.

```js
import { bearerAuth } from "@rabbit-company/web-middleware";

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

### Basic Auth

HTTP Basic Authentication for simple username/password protection. Automatically handles base64 decoding and credential parsing.

```js
import { basicAuth } from "@rabbit-company/web-middleware";

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

#### Security Notes:

- Always use HTTPS in production to protect credentials
- Consider using Bearer Auth for API endpoints
- Store passwords hashed (bcrypt, argon2) never in plain text
- Basic Auth credentials are sent with every request

### CORS

Configure Cross-Origin Resource Sharing.

```js
import { cors } from "@rabbit-company/web-middleware";

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

### Rate Limiting

Advanced rate limiting with multiple algorithms to prevent API abuse and ensure fair usage..

```js
import { rateLimit, Algorithm, createRateLimiter } from "@rabbit-company/web-middleware";

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
	useIp: true, // Include IP address
	useUserId: true, // Include user ID if authenticated
	useSessionId: false, // Don't use session
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

## 📦 Dependencies

- `@rabbit-company/web` - Core web framework (peer dependency)
- `@rabbit-company/logger` - Flexible logging library with multiple transports
- `@rabbit-company/rate-limiter` - High-performance rate limiting

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](https://github.com/Rabbit-Company/Web-JS/blob/main/LICENSE) file for details. 🐇💕
