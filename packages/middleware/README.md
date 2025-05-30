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
import { bearerAuth, cors, rateLimit } from "@rabbit-company/web-middleware";

const app = new Web();

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

## 📦 Dependencies

- `@rabbit-company/web` - Core web framework (peer dependency)
- `@rabbit-company/rate-limiter` - High-performance rate limiting

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](https://github.com/Rabbit-Company/Web-JS/blob/main/LICENSE) file for details. 🐇💕
