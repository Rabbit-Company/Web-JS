# 🚀 @rabbit-company/web

[![NPM Version](https://img.shields.io/npm/v/@rabbit-company/web)](https://www.npmjs.com/package/@rabbit-company/web)
[![JSR Version](https://jsr.io/badges/@rabbit-company/web)](https://jsr.io/@rabbit-company/web)
[![License](https://img.shields.io/npm/l/@rabbit-company/web)](LICENSE)

A high-performance web framework built for **Bun**, **Deno** and **NodeJS** with trie-based routing, middleware support, and TypeScript-first design. ⚡

## ✨ Features

- ⚡ **Blazing fast** trie-based router
- 🧩 **Middleware pipeline** with path matching
- 🛠 **TypeScript** first-class support
- 🧭 **Route scoping** for modular apps
- 🔥 **Zero dependencies**
- 📦 **<10kB** minified
- 🧵 **Async/await** ready
- 🛡 **Error handling** built-in

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

```js
import { Web } from '@rabbit-company/web';

const app = new Web<{ user?: { id: string } }>();

// Middleware
app.use(async (ctx, next) => {
  console.log(`${ctx.req.method} ${ctx.req.url}`);
  await next();
});

// Routes
app.get('/', (ctx) => ctx.text('Hello Bun! 🐇'));

app.get('/users/:id', async (ctx) => {
  const user = await getUser(ctx.params.id);
  return ctx.json(user);
});

// Start server
Bun.serve({
  port: 3000,
  fetch: app.handle
});

console.log('Server running at http://localhost:3000');
```

## 📚 Documentation

### 🛣 Routing

```js
// Basic routes
app.get("/path", handler);
app.post("/path", handler);
app.put("/path", handler);
app.patch("/path", handler);
app.delete("/path", handler);

// Dynamic routes
app.get("/users/:id", (ctx) => {
	return ctx.text(`User ID: ${ctx.params.id}`);
});

// Wildcard routes
app.get("/files/*", (ctx) => {
	return ctx.text(`Requested file: ${ctx.params["*"]}`);
});
```

### 🧩 Middleware

```js
// Global middleware
app.use(async (ctx, next) => {
	console.log("Request started");
	await next();
	console.log("Request completed");
});

// Path-specific middleware
app.use("/admin", adminAuthMiddleware);

// Method + path middleware
app.use("POST", "/users", validateUserMiddleware);
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
// API v1 routes
app.scope("/api/v1", (v1) => {
	v1.get("/users", getUsers);
	v1.post("/users", createUser);
});

// Mount sub-apps
const adminApp = new Web();
adminApp.get("/dashboard", dashboardHandler);
app.route("/admin", adminApp);
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

### ⚡ Performance

Benchmarks against popular frameworks:

```js
bun test v1.2.14 (6a363a38)

tests/benchmark.test.ts:
Web Framework (Simple): 1846.04ms for 1000000 requests (541,699 req/s) (checksum: 16917279)
Hono Framework (Simple): 2088.42ms for 1000000 requests (478,831 req/s) (checksum: 16916727)
Elysia Framework (Simple): 1077.81ms for 1000000 requests (927,808 req/s) (checksum: 16916772)
✓ Comprehensive Framework Benchmarks > Simple Route Benchmark > benchmarks simple GET route [5074.96ms]
Web Framework (Complex): 2028.02ms for 1000000 requests (493,091 req/s) (checksum: 23023000)
Hono Framework (Complex): 2743.23ms for 1000000 requests (364,534 req/s) (checksum: 23023000)
Elysia Framework (Complex): 1455.79ms for 1000000 requests (686,912 req/s) (checksum: 23023000)
✓ Comprehensive Framework Benchmarks > Complex Routing Benchmark > benchmarks complex routing scenarios [6241.95ms]
Web Framework (Middleware): 2557.90ms for 1000000 requests (390,945 req/s) (checksum: 80080024)
Hono Framework (Middleware): 3737.22ms for 1000000 requests (267,579 req/s) (checksum: 80080024)
Elysia Framework (Middleware): 1641.12ms for 1000000 requests (609,341 req/s) (checksum: 80080024)
✓ Comprehensive Framework Benchmarks > Middleware Benchmark > benchmarks middleware performance [7953.94ms]
Web Framework (Params): 2008.88ms for 1000000 requests (497,791 req/s) (checksum: 27227200)
Hono Framework (Params): 3062.60ms for 1000000 requests (326,520 req/s) (checksum: 21421400)
Elysia Framework (Params): 1457.14ms for 1000000 requests (686,275 req/s) (checksum: 27227200)
✓ Comprehensive Framework Benchmarks > Parameter Extraction Benchmark > benchmarks parameter extraction performance [6544.95ms]
Web Framework (JSON Body): 204.27ms for 50000 requests (244,771 req/s) (checksum: 5490984)
Hono Framework (JSON Body): 214.84ms for 50000 requests (232,733 req/s) (checksum: 5490984)
Elysia Framework (JSON Body): 148.23ms for 50000 requests (337,314 req/s) (checksum: 5490984)
✓ Comprehensive Framework Benchmarks > JSON Body Parsing Benchmark > benchmarks JSON body parsing performance [588.00ms]
```

_Tested on Framework 16 laptop (Ryzen 7040 Series)_

### 📄 License

This project is licensed under the MIT License - see the [LICENSE](https://github.com/Rabbit-Company/Web-JS/blob/main/LICENSE) file for details. 🐇💕
