import { Web } from "../packages/core/src/index.ts";
import { cors } from "../packages/middleware/src/cors.ts";

const app = new Web();

app.use(cors());

app.get("/", async (ctx) => ctx.html(`<h1>Hello World from ${ctx.clientIp}</h1>`));

app.listen({ port: 3000 });
