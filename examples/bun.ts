import { Web } from "../src";

const app = new Web<{ reqUUID: string }>();

app.use(async (c, next) => {
	c.state.reqUUID = crypto.randomUUID();
	await next();
});

app.use(async (c, next) => {
	const start = performance.now();
	await next();
	const duration = performance.now() - start;
	console.log(`[${c.req.method}] ${new URL(c.req.url).pathname} - ${duration.toFixed(2)}ms`);
});

app.get("/", (c) => c.text("Hello Bun!"));
app.get("/info", (c) => c.html("<h1>Hello Bun!</h1>"));
app.get("/stats", (c) => {
	return c.json({ uuid: c.state.reqUUID });
});

Bun.serve({
	port: 8080,
	fetch: app.handle,
});
