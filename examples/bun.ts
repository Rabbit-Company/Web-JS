import { Web } from "../src";

/**
 * Web Framework Usage Examples
 *
 * This file demonstrates the core features of the Web framework through practical examples.
 * It covers:
 * - Basic routing
 * - Middleware
 * - State management
 * - Response helpers
 * - Error handling
 */

// 1. Initialize the app with custom state type
const app = new Web<{
	reqUUID: string; // Unique request identifier
	startTime: number; // Performance measurement
	user?: {
		// Optional authenticated user
		id: string;
		name: string;
	};
}>();

// 2. Global Middleware - Runs on every request
app.use(async (ctx, next) => {
	// Add unique request ID to state
	ctx.state.reqUUID = crypto.randomUUID();

	// Store start time for performance measurement
	ctx.state.startTime = performance.now();

	// Set common response headers
	ctx.header("X-Request-ID", ctx.state.reqUUID);
	ctx.header("X-Powered-By", "Bun-Web");

	await next();

	// Log request details after completion
	const duration = performance.now() - ctx.state.startTime;
	console.log(`[${ctx.state.reqUUID}] ${ctx.req.method} ${new URL(ctx.req.url).pathname} - ${duration.toFixed(2)}ms`);
});

// 3. Route-Specific Middleware - Only runs on /admin routes
app.use("/admin/*", async (ctx, next) => {
	// Simulate authentication
	const authToken = ctx.req.headers.get("Authorization");

	if (!authToken) {
		return ctx.json({ error: "Unauthorized" }, 401);
	}

	// Add user to state if authenticated
	ctx.state.user = {
		id: "user-123",
		name: "Admin User",
	};

	await next();
});

// 4. Basic Routes
app.get("/", (ctx) => ctx.text("Welcome to Bun Web Framework!"));
app.get("/about", (ctx) => ctx.html("<h1>About Us</h1><p>Built with Bun!</p>"));

// 5. JSON API Endpoints
app.get("/api/info", (ctx) => {
	return ctx.json({
		requestId: ctx.state.reqUUID,
		timestamp: Date.now(),
		userAgent: ctx.req.headers.get("User-Agent"),
	});
});

// 6. Protected Admin Route
app.get("/admin/dashboard", (ctx) => {
	return ctx.json({
		user: ctx.state.user,
		metrics: {
			activeUsers: 42,
			serverLoad: 0.75,
		},
	});
});

// 7. Dynamic Routes with Parameters
app.get("/users/:id", async (ctx) => {
	const userId = ctx.params.id;
	// Simulate database lookup
	const user = { id: userId, name: `User ${userId}` };
	return ctx.json(user);
});

// 8. POST Request with Body Parsing
app.post("/users", async (ctx) => {
	const newUser = await ctx.body<{ name: string; email: string }>();

	// In a real app, you would validate and save to database
	return ctx.json(
		{
			id: "user-" + Math.random().toString(36).substring(2, 9),
			...newUser,
			createdAt: new Date().toISOString(),
		},
		201
	); // 201 Created status
});

// 9. Error Handling
app.onError((err, ctx) => {
	console.error(`[ERROR] ${ctx.state.reqUUID}`, err);

	return ctx.json(
		{
			error: "Something went wrong",
			requestId: ctx.state.reqUUID,
			timestamp: new Date().toISOString(),
		},
		500
	);
});

// 10. Start the server
const server = Bun.serve({
	port: process.env.PORT || 8080,
	hostname: "0.0.0.0",
	fetch: app.handle,
	error: (err) => {
		console.error("Server error:", err);
		return new Response("Internal Server Error", { status: 500 });
	},
});

console.log(`Server running at http://${server.hostname}:${server.port}`);
