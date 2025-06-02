import { Web } from "../packages/core/dist/index.js";

const app = new Web();

app.get("/", async (ctx) => ctx.html(`<h1>Hello World from ${ctx.clientIp}</h1>`));

app.listen({ port: 3000 });
