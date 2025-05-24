// src/index.ts
class TrieNode {
  segment;
  children = new Map;
  paramChild;
  wildcardChild;
  handlers;
  method;
  constructor(segment) {
    this.segment = segment;
  }
}

class Web {
  routes = [];
  middlewares = [];
  methodMiddlewareCache = new Map;
  roots = {
    GET: new TrieNode,
    POST: new TrieNode,
    PUT: new TrieNode,
    DELETE: new TrieNode,
    PATCH: new TrieNode,
    OPTIONS: new TrieNode,
    HEAD: new TrieNode
  };
  constructor() {
    this.handle = this.handle.bind(this);
  }
  clearMethodCache() {
    this.methodMiddlewareCache.clear();
  }
  errorHandler;
  onError(handler) {
    this.errorHandler = handler;
    return this;
  }
  use(...args) {
    this.clearMethodCache();
    if (args.length === 1) {
      const [handler] = args;
      this.middlewares.push({
        match: () => ({ matched: true, params: {} }),
        handler
      });
    } else if (args.length === 2) {
      const [path, handler] = args;
      const segments = path.split("/").filter(Boolean);
      const match = createPathMatcherSegments(segments);
      this.middlewares.push({
        path,
        match: (url) => match(url.split("/").filter(Boolean)),
        handler
      });
    } else {
      const [method, path, handler] = args;
      const segments = path.split("/").filter(Boolean);
      const match = createPathMatcherSegments(segments);
      this.middlewares.push({
        method,
        path,
        match: (url) => match(url.split("/").filter(Boolean)),
        handler
      });
    }
    return this;
  }
  addRoute(method, path, ...handlers) {
    const segments = path.split("/").filter(Boolean);
    let node = this.roots[method];
    for (const segment of segments) {
      if (segment === "*") {
        if (!node.wildcardChild) {
          node.wildcardChild = new TrieNode("*");
        }
        node = node.wildcardChild;
        break;
      } else if (segment.startsWith(":")) {
        const paramName = segment.slice(1);
        if (!node.paramChild) {
          node.paramChild = {
            node: new TrieNode(segment),
            name: paramName
          };
        }
        node = node.paramChild.node;
      } else {
        if (!node.children.has(segment)) {
          node.children.set(segment, new TrieNode(segment));
        }
        node = node.children.get(segment);
      }
    }
    node.handlers = handlers;
    node.method = method;
    const matcher = createPathMatcherSegments(segments);
    this.routes.push({
      method,
      path,
      handlers,
      match: (url) => matcher(url.split("/").filter(Boolean))
    });
  }
  match(method, path) {
    if (!this.roots[method])
      return null;
    const segments = path.split("/").filter(Boolean);
    const params = {};
    let node = this.roots[method];
    let i = 0;
    while (node && i < segments.length) {
      const segment = segments[i];
      const staticChild = node.children.get(segment);
      if (staticChild) {
        node = staticChild;
        i++;
        continue;
      }
      if (node.paramChild) {
        params[node.paramChild.name] = decodeURIComponent(segment);
        node = node.paramChild.node;
        i++;
        continue;
      }
      if (node.wildcardChild) {
        params["*"] = segments.slice(i).join("/");
        node = node.wildcardChild;
        break;
      }
      return null;
    }
    if (i === segments.length || node.segment === "*") {
      return node.handlers ? { handlers: node.handlers, params } : null;
    }
    return null;
  }
  getMethodMiddlewares(method) {
    if (this.methodMiddlewareCache.has(method)) {
      return this.methodMiddlewareCache.get(method);
    }
    const result = this.middlewares.filter((mw) => {
      if (mw.method && mw.method !== method)
        return false;
      return true;
    });
    this.methodMiddlewareCache.set(method, result);
    return result;
  }
  scope(path, callback) {
    const scopedApp = new this.constructor;
    callback(scopedApp);
    const baseSegments = path.split("/").filter(Boolean);
    for (const mw of scopedApp.middlewares) {
      const originalMatch = mw.match;
      const prefixedMatch = (url) => {
        const urlSegments = url.split("/").filter(Boolean);
        if (urlSegments.length < baseSegments.length) {
          return { matched: false, params: {} };
        }
        for (let i = 0;i < baseSegments.length; i++) {
          if (baseSegments[i] !== urlSegments[i]) {
            return { matched: false, params: {} };
          }
        }
        const subSegments = urlSegments.slice(baseSegments.length);
        const subPath = "/" + subSegments.join("/");
        return originalMatch(subPath);
      };
      this.middlewares.push({
        ...mw,
        match: prefixedMatch,
        path: path + (mw.path ?? "")
      });
    }
    this.route(path, scopedApp);
    return this;
  }
  route(prefix, subApp) {
    for (const route of subApp.routes) {
      const newPath = joinPaths(prefix, route.path);
      this.addRoute(route.method, newPath, ...route.handlers);
    }
    return this;
  }
  get(path, ...handlers) {
    this.addRoute("GET", path, ...handlers);
    return this;
  }
  post(path, ...handlers) {
    this.addRoute("POST", path, ...handlers);
    return this;
  }
  put(path, ...handlers) {
    this.addRoute("PUT", path, ...handlers);
    return this;
  }
  delete(path, ...handlers) {
    this.addRoute("DELETE", path, ...handlers);
    return this;
  }
  patch(path, ...handlers) {
    this.addRoute("PATCH", path, ...handlers);
    return this;
  }
  options(path, ...handlers) {
    this.addRoute("OPTIONS", path, ...handlers);
    return this;
  }
  head(path, ...handlers) {
    this.addRoute("HEAD", path, ...handlers.map((handler) => async (ctx, next) => {
      const res = await handler(ctx, next);
      if (res instanceof Response) {
        return new Response(null, {
          status: res.status,
          headers: res.headers
        });
      }
      return res;
    }));
    return this;
  }
  async handle(req) {
    const url = new URL(req.url);
    const method = req.method;
    const path = url.pathname;
    try {
      const matched = this.match(method, path);
      if (!matched) {
        return new Response("Not Found", { status: 404 });
      }
      const methodMiddlewares = this.getMethodMiddlewares(method);
      const middlewares = [];
      const params = matched.params;
      for (const mw of methodMiddlewares) {
        const matchResult = mw.match(path);
        if (matchResult.matched) {
          Object.assign(params, matchResult.params);
          middlewares.push(mw.handler);
        }
      }
      const ctx = {
        req,
        params,
        state: {},
        header: (name, value) => {},
        set: (key, value) => {
          ctx.state[key] = value;
        },
        get: (key) => ctx.state[key],
        redirect: (url2, status = 302) => {
          return new Response(null, {
            status,
            headers: { Location: url2 }
          });
        },
        body: async () => {
          if (!req.body)
            return {};
          const type = req.headers.get("content-type") ?? "";
          if (type.includes("application/x-www-form-urlencoded")) {
            const formData = await req.formData();
            return Object.fromEntries(formData.entries());
          }
          return type.includes("application/json") ? req.json() : {};
        },
        json: (data, status = 200, headers) => {
          const responseHeaders = new Headers({
            "Content-Type": "application/json",
            ...headers
          });
          return new Response(JSON.stringify(data), { status, headers: responseHeaders });
        },
        text: (data, status = 200, headers) => {
          const responseHeaders = new Headers({
            "Content-Type": "text/plain",
            ...headers
          });
          return new Response(data, { status, headers: responseHeaders });
        },
        html: (html, status = 200, headers) => {
          const responseHeaders = new Headers({
            "Content-Type": "text/html; charset=utf-8",
            ...headers
          });
          return new Response(html, { status, headers: responseHeaders });
        },
        query: () => new URLSearchParams(url.search)
      };
      const stack = [...middlewares, ...matched.handlers ?? []];
      let response;
      for (const fn of stack) {
        const result = await fn(ctx, async () => {});
        if (result instanceof Response) {
          response = result;
          break;
        }
      }
      return response ?? new Response("No response returned by handler", { status: 500 });
    } catch (err) {
      if (this.errorHandler) {
        const errorCtx = {
          req,
          params: {},
          state: {},
          text: (data, status = 500) => new Response(data, { status }),
          json: (data, status = 500) => new Response(JSON.stringify(data), {
            status,
            headers: { "Content-Type": "application/json" }
          }),
          html: (html, status = 500) => new Response(html, {
            status,
            headers: { "Content-Type": "text/html" }
          }),
          query: () => url.searchParams,
          body: async () => ({}),
          header: () => {},
          set: () => {},
          get: () => {
            return;
          },
          redirect: () => new Response(null, { status: 302 })
        };
        return this.errorHandler(err, errorCtx);
      }
      return new Response("Internal Server Error", { status: 500 });
    }
  }
}
function createPathMatcherSegments(segments) {
  return (urlSegments) => {
    if (urlSegments.length < segments.length)
      return { matched: false, params: {} };
    const params = {};
    for (let i = 0;i < segments.length; i++) {
      const seg = segments[i];
      const part = urlSegments[i];
      if (seg === "*")
        return { matched: true, params };
      if (seg?.startsWith(":")) {
        if (!part)
          return { matched: false, params: {} };
        params[seg.slice(1)] = decodeURIComponent(part);
      } else if (seg !== part) {
        return { matched: false, params: {} };
      }
    }
    const matched = urlSegments.length === segments.length;
    return { matched, params: matched ? params : {} };
  };
}
function joinPaths(...paths) {
  return "/" + paths.map((p) => p.replace(/^\/|\/$/g, "")).filter(Boolean).join("/");
}
export {
  Web
};
