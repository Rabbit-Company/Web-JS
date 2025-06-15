import { Web } from "@rabbit-company/web";
import { bearerAuth } from "@rabbit-company/web-middleware/bearer-auth";
import { bodyLimit } from "@rabbit-company/web-middleware/body-limit";
import { cors } from "@rabbit-company/web-middleware/cors";

// Cloudflare env Bindings
type Bindings = {
	API_KEY: string;
};

const app = new Web<{ userId: string }, Bindings>();

app.use(cors());
app.use(bodyLimit({ maxSize: "10mb" }));
app.use(
	"/api/*",
	bearerAuth({
		validate(token, ctx) {
			return token === "validToken";
		},
	})
);

app.use(async (ctx, next) => {
	ctx.set("userId", ctx.clientIp || "unknown");
	await next();
});

app.get("/", (ctx) => {
	return ctx.html("<h1>Hello from Cloudflare Workers</h1>");
});

app.get("/api/info", (ctx) => {
	return ctx.json({ version: "0.0.1", clientIP: ctx.clientIp });
});

export default {
	fetch: app.handleCloudflare,
};
