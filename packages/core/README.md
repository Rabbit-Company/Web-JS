# 🚀 @rabbit-company/web

[![NPM Version](https://img.shields.io/npm/v/@rabbit-company/web)](https://www.npmjs.com/package/@rabbit-company/web)
[![JSR Version](https://jsr.io/badges/@rabbit-company/web)](https://jsr.io/@rabbit-company/web)
[![License](https://img.shields.io/npm/l/@rabbit-company/web)](LICENSE)

A high-performance web framework built for **Bun**, **Deno**, **NodeJS** and **Cloudflare Workers** with trie-based routing, middleware support, and TypeScript-first design. ⚡

## ✨ Features

- ⚡ **Blazing fast** trie-based router
- 🧩 **Middleware pipeline** with path matching
- 🔄 **Dynamic route/middleware removal** for hot-reloading
- 🛠 **TypeScript** first-class support
- 🧭 **Route scoping** for modular apps
- 🧵 **Async/await** ready
- 🛡 **Error handling** built-in
- 🔌 **WebSocket support** with automatic upgrades

## 📦 Installation

```bash
# npm
npm install @rabbit-company/web

# yarn
yarn add @rabbit-company/web

# pnpm
pnpm add @rabbit-company/web
```

## 🎯 Quick Start

### Basic HTTP Server

```js
import { Web } from '@rabbit-company/web';

const app = new Web<{ user?: { id: string } }>();

// Middleware
app.use(async (ctx, next) => {
	console.log(`${ctx.req.method} ${ctx.req.url}`);
	await next();
});

// Routes
app.get('/', (ctx) => ctx.text('Hello!'));

app.get('/users/:id', async (ctx) => {
	const user = await getUser(ctx.params.id);
	return ctx.json(user);
});

// Start server on Node, Deno or Bun
app.listen({ port: 3000 });

// Start server on Cloudflare Workers
export default {
	fetch: app.handleCloudflare,
};

console.log('Server running at http://localhost:3000');
```

### WebSocket Server

```js
import { Web } from "@rabbit-company/web";

const app = new Web();

// Configure WebSocket handlers
app.websocket({
	idleTimeout: 120,
	maxPayloadLength: 1024 * 1024, // 1 MB
	open(ws) {
		console.log("WebSocket connected");
		ws.subscribe("chat-room");
	},
	message(ws, message) {
		console.log("Received:", message);
		// Echo message back
		ws.send(`Echo: ${message}`);
		// Broadcast to room
		ws.publish("chat-room", `User: ${message}`);
	},
	close(ws) {
		console.log("WebSocket disconnected");
		ws.unsubscribe("chat-room");
	},
});

// WebSocket upgrade route
app.get("/ws", (ctx) => {
	if (ctx.req.headers.get("upgrade") === "websocket") {
		// Framework automatically handles upgrade
		return new Response(null, { status: 101 });
	}
	return ctx.text("Use WebSocket protocol to connect");
});

// HTTP route that broadcasts to WebSocket clients
app.post("/broadcast", async (ctx) => {
	const { message } = await ctx.body();

	server.publish("chat-room", message);

	return ctx.json({ success: true, message: "Broadcast sent" });
});

// Start server with WebSocket support
const server = await app.listen({ port: 3000 });
console.log("Server with WebSocket support running at http://localhost:3000");
```

## 📚 Documentation

### 🛣 Routing

```js
// Basic routes (chainable)
app.get("/path", handler).post("/path", handler).put("/path", handler).patch("/path", handler).delete("/path", handler);

// Dynamic routes
app.get("/users/:id", (ctx) => {
	return ctx.text(`User ID: ${ctx.params.id}`);
});

// Wildcard routes
app.get("/files/*", (ctx) => {
	return ctx.text(`Requested file: ${ctx.params["*"]}`);
});

// Routes with removal capability
const routeId = app.addRoute("GET", "/temp", handler);
// Remove later
app.removeRoute(routeId);
```

### 🔌 WebSocket Support

```js
// Configure WebSocket handlers
app.websocket({
	// Maximum time in seconds WebSocket can be idle
	idleTimeout: 120,

	// Maximum message size in bytes
	maxPayloadLength: 1024 * 1024,

	// Called when connection is established
	open(ws) {
		console.log("Client connected");
		ws.subscribe("notifications");
	},

	// Called when message is received
	message(ws, message) {
		console.log("Received:", message);
		ws.send(`You said: ${message}`);
	},

	// Called when connection is closed
	close(ws) {
		console.log("Client disconnected");
		ws.unsubscribe("notifications");
	},

	// Called on connection error
	error(ws, error) {
		console.error("WebSocket error:", error);
	},

	// Called when backpressure is relieved
	drain(ws) {
		console.log("WebSocket drained");
	},
});

// WebSocket upgrade route
app.get("/chat", (ctx) => {
	if (ctx.req.headers.get("upgrade") === "websocket") {
		// Framework handles upgrade automatically
		return new Response(null, { status: 101 });
	}
	return ctx.text("WebSocket endpoint - upgrade required");
});

// Dynamic WebSocket rooms
app.get("/room/:roomId", (ctx) => {
	if (ctx.req.headers.get("upgrade") === "websocket") {
		return new Response(null, { status: 101 });
	}
	return ctx.text(`Join room ${ctx.params.roomId} via WebSocket`);
});
```

### 🔄 Dynamic Route Management

```js
// Add routes that can be removed later
const tempRoute = app.addRoute("GET", "/temporary", (ctx) => {
	return ctx.text("This route can be removed");
});

const userRoute = app.addRoute("POST", "/users", createUserHandler);

// Remove individual routes
app.removeRoute(tempRoute);

// Remove routes by criteria
app.removeRoutesBy({ method: "GET" }); // Remove all GET routes
app.removeRoutesBy({ path: "/users" }); // Remove all /users routes
app.removeRoutesBy({ method: "POST", path: "/users" }); // Specific route

// List all routes
const routes = app.getRoutes();
console.log(routes); // [{ id: '...', method: 'GET', path: '/users/:id' }]

// Clear all routes and middleware
app.clear();
```

### 🧩 Middleware ([`@rabbit-company/web-middleware`](https://www.npmjs.com/package/@rabbit-company/web-middleware))

```js
// Global middleware (chainable)
app.use(async (ctx, next) => {
	console.log("Request started");
	await next();
	console.log("Request completed");
});

// Path-specific middleware (chainable)
app.use("/admin", adminAuthMiddleware)
	 .use("POST", "/users", validateUserMiddleware);

// Middleware with removal capability
const authId = app.addMiddleware('/admin', (ctx, next) => {
	// Authentication logic
	await next();
});

const loggingId = app.addMiddleware(async (ctx, next) => {
	console.log(`${ctx.req.method} ${ctx.req.url}`);
	await next();
});

// Remove middleware
app.removeMiddleware(authId);

// Remove middleware by criteria
app.removeMiddlewareBy({ method: 'POST' }); // Remove all POST middleware
app.removeMiddlewareBy({ path: '/admin' }); // Remove all /admin middleware

// List all middleware
const middlewares = app.getMiddlewares();
console.log(middlewares); // [{ id: '...', method: 'POST', path: '/users' }]
```

### 🔄 Hot Reloading Example

```js
// Perfect for development hot-reloading
const routeManager = new Map();

function hotReload(routePath, newHandler) {
	// Remove old route if exists
	if (routeManager.has(routePath)) {
		app.removeRoute(routeManager.get(routePath));
	}

	// Add new route
	const routeId = app.addRoute("GET", routePath, newHandler);
	routeManager.set(routePath, routeId);
}

// Update route without restarting server
hotReload("/api/users", newUserHandler);
```

### 🎛 Context API

```js
// Request info
ctx.req; // Original Request object
ctx.params; // Route parameters
ctx.query(); // URL query params

// State management
ctx.set("user", user); // Set state
ctx.get("user"); // Get state

// Response helpers
ctx.text("Hello"); // Text response
ctx.json({ data }); // JSON response
ctx.html("<h1>Hi</h1>"); // HTML response
ctx.redirect("/new"); // Redirect

// Headers
ctx.header("X-Custom", "Value"); // Set response header
```

### 🗂 Route Scoping

```js
// API v1 routes (chainable)
app.scope("/api/v1", (v1) => {
	v1.get("/users", getUsers).post("/users", createUser);
});

// Mount sub-apps
const adminApp = new Web();
adminApp.get("/dashboard", dashboardHandler);
app.route("/admin", adminApp);

// Scoped routes can still be removed by criteria
app.removeRoutesBy({ path: "/api/v1/users" });
```

### 🛡 Error Handling

```js
// Global error handler
app.onError((err, ctx) => {
	console.error(err);
	return ctx.json({ error: "Something went wrong" }, 500);
});

// Route error handling
app.get("/danger", async (ctx) => {
	try {
		// Risky operation
	} catch (err) {
		return ctx.json({ error: err.message }, 400);
	}
});
```

### 🔧 API Reference

#### Route Management

- `get(path, ...handlers)` - Add GET route (chainable)
- `post(path, ...handlers)` - Add POST route (chainable)
- `put(path, ...handlers)` - Add PUT route (chainable)
- `patch(path, ...handlers)` - Add PATCH route (chainable)
- `delete(path, ...handlers)` - Add DELETE route (chainable)
- `options(path, ...handlers)` - Add OPTIONS route (chainable)
- `head(path, ...handlers)` - Add HEAD route (chainable)
- `addRoute(method, path, ...handlers)` - Add route with ID return
- `removeRoute(id)` - Remove route by ID
- `removeRoutesBy(criteria)` - Remove routes by method/path
- `getRoutes()` - List all routes with metadata

#### WebSocket Management

- `websocket(handlers)` - Configure WebSocket handlers (chainable)
- WebSocket handlers: `open`, `message`, `close`, `error`, `drain`, `ping`, `pong`
- Automatic upgrade handling for WebSocket requests

#### Middleware Management

- `use(...args)` - Add middleware (chainable)
- `addMiddleware(...args)` - Add middleware with ID return
- `removeMiddleware(id)` - Remove middleware by ID
- `removeMiddlewareBy(criteria)` - Remove middleware by method/path
- `getMiddlewares()` - List all middleware with metadata

#### Application Management

- `scope(path, callback)` - Create scoped sub-application
- `route(prefix, subApp)` - Mount sub-application
- `clear()` - Remove all routes and middleware
- `onError(handler)` - Set global error handler
- `handle(request)` - Main request handler

### ⚡ Performance

Benchmarks against popular frameworks:

```js
bun test v1.2.14 (6a363a38)

tests/benchmark.test.ts:
Web Framework (Simple): 1585.39ms for 1000000 requests (630,758 req/s) (checksum: 16916310)
Hono Framework (Simple): 2050.02ms for 1000000 requests (487,801 req/s) (checksum: 16916359)
Elysia Framework (Simple): 1072.74ms for 1000000 requests (932,192 req/s) (checksum: 16916953)
✓ Comprehensive Framework Benchmarks > Simple Route Benchmark > benchmarks simple GET route [4731.96ms]
Web Framework (Complex): 1754.07ms for 1000000 requests (570,102 req/s) (checksum: 23023000)
Hono Framework (Complex): 2581.80ms for 1000000 requests (387,326 req/s) (checksum: 23023000)
Elysia Framework (Complex): 1402.50ms for 1000000 requests (713,015 req/s) (checksum: 23023000)
✓ Comprehensive Framework Benchmarks > Complex Routing Benchmark > benchmarks complex routing scenarios [5751.95ms]
Web Framework (Middleware): 2401.10ms for 1000000 requests (416,475 req/s) (checksum: 80080024)
Hono Framework (Middleware): 3583.00ms for 1000000 requests (279,096 req/s) (checksum: 80080024)
Elysia Framework (Middleware): 1572.81ms for 1000000 requests (635,803 req/s) (checksum: 80080024)
✓ Comprehensive Framework Benchmarks > Middleware Benchmark > benchmarks middleware performance [7575.94ms]
Web Framework (Params): 1628.38ms for 1000000 requests (614,106 req/s) (checksum: 27227200)
Hono Framework (Params): 2887.76ms for 1000000 requests (346,289 req/s) (checksum: 21421400)
Elysia Framework (Params): 1387.94ms for 1000000 requests (720,491 req/s) (checksum: 27227200)
✓ Comprehensive Framework Benchmarks > Parameter Extraction Benchmark > benchmarks parameter extraction performance [5918.95ms]
Web Framework (JSON Body): 191.21ms for 50000 requests (261,490 req/s) (checksum: 5490984)
Hono Framework (JSON Body): 199.59ms for 50000 requests (250,512 req/s) (checksum: 5490984)
Elysia Framework (JSON Body): 141.65ms for 50000 requests (352,983 req/s) (checksum: 5490984)
✓ Comprehensive Framework Benchmarks > JSON Body Parsing Benchmark > benchmarks JSON body parsing performance [552.00ms]
```

_Tested on Framework 16 laptop (Ryzen 7040 Series)_

### 📄 License

This project is licensed under the MIT License - see the [LICENSE](https://github.com/Rabbit-Company/Web-JS/blob/main/LICENSE) file for details. 🐇💕
