import { Web } from "../src";

const app = new Web<{ reqUUID: string }>();

app.use((c) => {
	c.state.reqUUID = crypto.randomUUID();
	return undefined;
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
