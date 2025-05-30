import { Web } from "../src";
import { basicAuth, bearerAuth, cors, rateLimit } from "../src/middleware";

/**
 * Web Framework Usage Examples
 *
 * This file demonstrates the core features of the Web framework through practical examples.
 * It covers:
 * - Basic routing and route parameters
 * - Middleware (global, scoped, and conditional)
 * - State management and context sharing
 * - Request parsing (JSON, form data, query params)
 * - Response helpers and streaming
 * - Error handling and validation
 * - Route groups and modular organization
 * - File uploads and static file serving
 * - WebSocket integration
 */

// Define types for our application state
interface AppState {
	[key: string]: unknown; // <-- this satisfies Record<string, unknown>
	reqUUID: string;
	startTime: number;
	user?: {
		id: string;
		name: string;
		role: "admin" | "user";
	};
}

// Initialize the main app
const app = new Web<AppState>();

// Configure CORS with options
app.use(
	cors({
		origin: ["http://localhost:8080", "https://myapp.com"],
		credentials: true,
		allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
		allowHeaders: ["Content-Type", "Authorization"],
	})
);

// Global request tracking middleware
app.use(async (ctx, next) => {
	// Generate unique request ID
	ctx.state.reqUUID = crypto.randomUUID();
	ctx.state.startTime = performance.now();

	// Add request ID to response headers
	ctx.header("X-Request-ID", ctx.state.reqUUID);
	ctx.header("X-Powered-By", "Web Framework by Rabbit Company");

	// Log incoming request
	const url = new URL(ctx.req.url);
	console.log(`→ [${ctx.state.reqUUID}] ${ctx.req.method} ${url.pathname}`);

	try {
		await next();
	} catch (error) {
		// Middleware can catch errors too
		console.error(`✗ [${ctx.state.reqUUID}] Error:`, error);
		throw error;
	}

	// Log response details
	const duration = performance.now() - ctx.state.startTime;
	console.log(`← [${ctx.state.reqUUID}] ${ctx.res?.status || 200} - ${duration.toFixed(2)}ms`);
});

// Rate limiting middleware - protect against abuse
app.use(
	rateLimit({
		windowMs: 60 * 1000, // 1 minute window
		max: 100, // limit each IP to 100 requests per windowMs
		message: "Too many requests, please try again later.",
		headers: true, // Send rate limit headers
		keyGenerator: (ctx) => {
			// Use IP address as the key
			return ctx.req.headers.get("x-forwarded-for") || ctx.req.headers.get("x-real-ip") || "127.0.0.1";
		},
		skip: (ctx) => {
			// Skip rate limiting for health checks
			const url = new URL(ctx.req.url);
			return url.pathname === "/api/health";
		},
	})
);

// Protected API endpoints with Bearer token auth
const protectedApi = new Web<AppState>();

// Rate limit more aggressively for auth endpoints
protectedApi.use(
	rateLimit({
		windowMs: 15 * 60 * 1000, // 15 minutes
		max: 10, // limit each IP to 10 requests per 15 minutes
		message: "Too many authentication attempts",
	})
);

// Bearer token authentication middleware
protectedApi.use(
	bearerAuth({
		validate(token, ctx) {
			if (token === "demo-token-admin") {
				ctx.state.user = {
					id: "user-123",
					name: "API Admin User",
					role: "admin",
				};
				return true;
			} else if (token === "demo-token-user") {
				ctx.state.user = {
					id: "user-456",
					name: "API User",
					role: "user",
				};
				return true;
			}

			return false;
		},
	})
);

// Protected endpoints
protectedApi.get("/profile", (ctx) => {
	return ctx.json({
		user: ctx.state.user,
		lastLogin: new Date().toISOString(),
	});
});

protectedApi.put("/profile", async (ctx) => {
	const updates = await ctx.body<{ name?: string; email?: string }>();

	// In production, update user in database
	return ctx.json({
		...ctx.state.user,
		...updates,
		updatedAt: new Date().toISOString(),
	});
});

// Mount protected API routes
app.route("/api/protected", protectedApi);

// ===== BASIC ROUTES =====

// Home page
app.get("/", (ctx) => {
	return ctx.html(`
		<!DOCTYPE html>
		<html>
		<head>
			<title>Web Framework by Rabbit Company</title>
			<style>
				body { font-family: system-ui; max-width: 800px; margin: 0 auto; padding: 2rem; }
				h1 { color: #333; }
				.endpoint { background: #f5f5f5; padding: 1rem; margin: 1rem 0; border-radius: 4px; }
				code { background: #e0e0e0; padding: 0.2rem 0.4rem; border-radius: 3px; }
			</style>
		</head>
		<body>
			<h1>🚀 Web Framework by Rabbit Company</h1>
			<p>A fast, modern web framework built for Bun runtime.</p>

			<h2>Available Endpoints:</h2>
			<div class="endpoint">
				<strong>GET /api/health</strong> - Health check
			</div>
			<div class="endpoint">
				<strong>GET /api/users/:id</strong> - Get user by ID
			</div>
			<div class="endpoint">
				<strong>POST /api/users</strong> - Create new user
			</div>
			<div class="endpoint">
				<strong>GET /api/posts</strong> - List posts (with pagination)
			</div>
			<div class="endpoint">
				<strong>POST /api/upload</strong> - File upload endpoint
			</div>
			<div class="endpoint">
				<strong>GET /admin/*</strong> - Admin routes (requires auth)
			</div>
		</body>
		</html>
	`);
});

// Health check endpoint
app.get("/api/health", (ctx) => {
	return ctx.json({
		status: "healthy",
		timestamp: new Date().toISOString(),
		uptime: process.uptime(),
		memory: process.memoryUsage(),
		version: "1.0.0",
	});
});

// ===== API ROUTES =====

// Create API route group with specific rate limiting
const api = new Web<AppState>();

// Apply stricter rate limiting for API endpoints
api.use(
	rateLimit({
		windowMs: 60 * 1000, // 1 minute
		max: 60, // 60 requests per minute for API
		message: "API rate limit exceeded",
		headers: true,
	})
);

// User endpoints
api.get("/users/:id", async (ctx) => {
	const userId = ctx.params.id;

	// Validate ID format
	if (!/^[a-zA-Z0-9-]+$/.test(userId)) {
		return ctx.json({ error: "Invalid user ID format" }, 400);
	}

	// Simulate database lookup
	await new Promise((resolve) => setTimeout(resolve, 100)); // Simulate DB delay

	const user = {
		id: userId,
		name: `User ${userId}`,
		email: `user${userId}@example.com`,
		createdAt: new Date().toISOString(),
	};

	return ctx.json(user);
});

// Create user with validation
api.post("/users", async (ctx) => {
	const body = await ctx.body<{
		name?: string;
		email?: string;
		age?: number;
	}>();

	// Validation
	const errors: string[] = [];

	if (!body.name || body.name.length < 2) {
		errors.push("Name must be at least 2 characters");
	}

	if (!body.email || !body.email.includes("@")) {
		errors.push("Valid email is required");
	}

	if (body.age !== undefined && (body.age < 0 || body.age > 150)) {
		errors.push("Age must be between 0 and 150");
	}

	if (errors.length > 0) {
		return ctx.json({ errors }, 400);
	}

	// Create user
	const newUser = {
		id: crypto.randomUUID(),
		...body,
		createdAt: new Date().toISOString(),
	};

	return ctx.json(newUser, 201);
});

// List posts with pagination and filtering
api.get("/posts", async (ctx) => {
	const url = new URL(ctx.req.url);
	const page = parseInt(url.searchParams.get("page") || "1");
	const limit = parseInt(url.searchParams.get("limit") || "10");
	const search = url.searchParams.get("search") || "";

	// Validate pagination params
	if (page < 1 || limit < 1 || limit > 100) {
		return ctx.json({ error: "Invalid pagination parameters" }, 400);
	}

	// Generate mock posts
	const totalPosts = 100;
	const posts = Array.from({ length: limit }, (_, i) => ({
		id: (page - 1) * limit + i + 1,
		title: `Post ${(page - 1) * limit + i + 1}`,
		content: `This is the content of post ${(page - 1) * limit + i + 1}`,
		author: `Author ${Math.floor(Math.random() * 10) + 1}`,
		tags: ["bun", "web", "framework"],
		createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
	})).filter((post) => (search ? post.title.toLowerCase().includes(search.toLowerCase()) : true));

	return ctx.json({
		data: posts,
		pagination: {
			page,
			limit,
			total: totalPosts,
			totalPages: Math.ceil(totalPosts / limit),
		},
		_links: {
			self: `/api/posts?page=${page}&limit=${limit}`,
			next: page < Math.ceil(totalPosts / limit) ? `/api/posts?page=${page + 1}&limit=${limit}` : null,
			prev: page > 1 ? `/api/posts?page=${page - 1}&limit=${limit}` : null,
		},
	});
});

// File upload endpoint
api.post("/upload", async (ctx) => {
	const formData = await ctx.req.formData();
	const file = formData.get("file") as File;

	if (!file) {
		return ctx.json({ error: "No file provided" }, 400);
	}

	// Validate file type and size
	const allowedTypes = ["image/jpeg", "image/png", "image/gif", "application/pdf"];
	const maxSize = 5 * 1024 * 1024; // 5MB

	if (!allowedTypes.includes(file.type)) {
		return ctx.json({ error: "Invalid file type" }, 400);
	}

	if (file.size > maxSize) {
		return ctx.json({ error: "File too large (max 5MB)" }, 400);
	}

	// In production, save file to storage service
	const fileInfo = {
		id: crypto.randomUUID(),
		name: file.name,
		type: file.type,
		size: file.size,
		uploadedAt: new Date().toISOString(),
	};

	return ctx.json({
		message: "File uploaded successfully",
		file: fileInfo,
	});
});

// Server-sent events endpoint
api.get("/events", (ctx) => {
	const headers = new Headers({
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});

	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();
			let count = 0;

			const interval = setInterval(() => {
				const data = JSON.stringify({
					time: new Date().toISOString(),
					count: count++,
					message: "Server event",
				});

				controller.enqueue(encoder.encode(`data: ${data}\n\n`));

				// Stop after 10 events
				if (count >= 10) {
					clearInterval(interval);
					controller.close();
				}
			}, 1000);
		},
	});

	return new Response(stream, { headers });
});

// Mount API routes
app.route("/api", api);

// ===== ADMIN ROUTES =====

const admin = new Web<AppState>();

// Apply basic auth to all admin routes
admin.use(
	basicAuth({
		validate: async (username, password, ctx) => {
			// In production, check against database with hashed passwords
			if (username === "admin" && password === "supersecret") {
				// Set the authenticated user in context
				ctx.state.user = {
					id: "admin-001",
					name: "Admin User",
					role: "admin",
				};
				return true;
			}

			// Regular user auth
			if (username === "user" && password === "password123") {
				ctx.state.user = {
					id: "user-001",
					name: "Regular User",
					role: "user",
				};
				return true;
			}

			return false;
		},
		realm: "Admin Area",
		contextKey: "user", // This will store auth info in ctx.state.user
	})
);

// Additional admin-only check
admin.use(async (ctx, next) => {
	if (ctx.state.user?.role !== "admin") {
		return ctx.json({ error: "Admin access required" }, 403);
	}
	await next();
});

// Admin dashboard
admin.get("/dashboard", (ctx) => {
	return ctx.json({
		message: "Welcome to admin dashboard",
		user: ctx.state.user,
		stats: {
			totalUsers: 1234,
			activeUsers: 567,
			revenue: "$12,345",
			serverLoad: Math.random(),
		},
	});
});

// System info (admin only)
admin.get("/system", (ctx) => {
	return ctx.json({
		platform: process.platform,
		version: process.version,
		uptime: process.uptime(),
		memory: process.memoryUsage(),
		cpu: process.cpuUsage(),
		env: process.env.NODE_ENV || "development",
	});
});

// Mount admin routes
app.route("/admin", admin);

// ===== WILDCARD & STATIC FILES =====

// Serve static files (in production, use a CDN or nginx)
app.get("/static/*", async (ctx) => {
	const path = ctx.params["*"];
	const file = Bun.file(`./public/${path}`);

	if (await file.exists()) {
		return new Response(file);
	}

	return ctx.text("File not found", 404);
});

// ===== ERROR HANDLING =====

// Custom 404 handler
app.onNotFound((ctx) => {
	const url = new URL(ctx.req.url);

	// Return JSON for API routes
	if (url.pathname.startsWith("/api/")) {
		return ctx.json(
			{
				error: "Endpoint not found",
				path: url.pathname,
				method: ctx.req.method,
			},
			404
		);
	}

	// Return HTML for other routes
	return ctx.html(
		`
		<!DOCTYPE html>
		<html>
		<head>
			<title>404 - Not Found</title>
			<style>
				body { font-family: system-ui; text-align: center; padding: 2rem; }
				h1 { font-size: 4rem; margin: 0; }
				p { color: #666; }
				a { color: #0066cc; }
			</style>
		</head>
		<body>
			<h1>404</h1>
			<p>The page you're looking for doesn't exist.</p>
			<a href="/">Go back home</a>
		</body>
		</html>
	`,
		404
	);
});

// Global error handler
app.onError((err, ctx) => {
	console.error(`[ERROR] ${ctx.state.reqUUID}`, err);

	// Don't leak error details in production
	const isDev = process.env.NODE_ENV === "development";

	return ctx.json(
		{
			error: isDev ? err.message : "Internal server error",
			requestId: ctx.state.reqUUID,
			timestamp: new Date().toISOString(),
			...(isDev && { stack: err.stack }),
		},
		500
	);
});

// ===== SERVER CONFIGURATION =====

const PORT = parseInt(process.env.PORT || "8080");
const HOSTNAME = "0.0.0.0";

// Create Bun server with WebSocket support
const server = Bun.serve({
	port: PORT,
	hostname: HOSTNAME,

	// Handle HTTP requests
	fetch: app.handle,

	// WebSocket configuration
	websocket: {
		open(ws) {
			console.log("WebSocket opened");
			ws.send(JSON.stringify({ type: "welcome", message: "Connected to WebSocket" }));
		},

		message(ws, message) {
			console.log("WebSocket message:", message);
			// Echo the message back
			ws.send(JSON.stringify({ type: "echo", data: message }));
		},

		close(ws) {
			console.log("WebSocket closed");
		},
	},

	// Server error handler
	error(error) {
		console.error("Server error:", error);
		return new Response("Internal Server Error", { status: 500 });
	},
});

// Graceful shutdown
process.on("SIGINT", () => {
	console.log("\nShutting down server...");
	server.stop();
	process.exit(0);
});

// Log server info
console.log(`
🚀 Server Started!

📍 Local:    http://localhost:${PORT}
📍 Network:  http://${HOSTNAME}:${PORT}
🌍 Env:      ${process.env.NODE_ENV || "development"}

Available routes:
- GET  /                      - Home page
- GET  /api/health            - Health check (no rate limit)
- GET  /api/users/:id         - Get user by ID
- POST /api/users             - Create user
- GET  /api/posts             - List posts (paginated)
- POST /api/upload            - Upload file
- GET  /api/events            - Server-sent events
- GET  /api/protected/profile - Get profile (Bearer auth)
- PUT  /api/protected/profile - Update profile (Bearer auth)
- GET  /admin/*               - Admin routes (Basic auth required)
- GET  /static/*              - Static files

Authentication:
- Admin panel: Basic Auth (admin:supersecret)
- API endpoints: Bearer token in Authorization header

Press Ctrl+C to stop
`);
