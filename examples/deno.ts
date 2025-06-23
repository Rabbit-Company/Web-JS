import { Web } from "../packages/core/src/index.ts";
import { cache } from "../packages/middleware/src/cache.ts";
import { cors } from "../packages/middleware/src/cors.ts";

const app = new Web();

app.use(cors());

app.use(cache());

app.get("/", async (ctx) => ctx.html(`<h1>Hello World from ${ctx.clientIp}</h1>`));

app.listen({ port: 3000 });
