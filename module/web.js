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
var EMPTY_PARAMS = Object.freeze({});
var EMPTY_SEARCH_PARAMS = new URLSearchParams;

class Web {
  routes = [];
  middlewares = [];
  methodMiddlewareCache = new Map;
  urlCache = new Map;
  segmentCache = new Map;
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
  clearCaches() {
    this.methodMiddlewareCache.clear();
    this.urlCache.clear();
    this.segmentCache.clear();
  }
  errorHandler;
  onError(handler) {
    this.errorHandler = handler;
    return this;
  }
  getPathSegments(path) {
    if (this.segmentCache.has(path)) {
      return this.segmentCache.get(path);
    }
    const segments = path.split("/").filter(Boolean);
    if (this.segmentCache.size < 500) {
      this.segmentCache.set(path, segments);
    }
    return segments;
  }
  parseUrl(url) {
    if (this.urlCache.has(url)) {
      return this.urlCache.get(url);
    }
    const queryStart = url.indexOf("?");
    const hashStart = url.indexOf("#");
    let end = url.length;
    if (queryStart !== -1)
      end = Math.min(end, queryStart);
    if (hashStart !== -1)
      end = Math.min(end, hashStart);
    const protocolEnd = url.indexOf("://");
    let pathname;
    if (protocolEnd === -1) {
      pathname = url.substring(0, end);
    } else {
      const hostStart = protocolEnd + 3;
      const pathStart = url.indexOf("/", hostStart);
      pathname = pathStart === -1 ? "/" : url.substring(pathStart, end);
    }
    let searchParams;
    if (queryStart !== -1) {
      const searchString = hashStart === -1 ? url.substring(queryStart + 1) : url.substring(queryStart + 1, hashStart);
      searchParams = new URLSearchParams(searchString);
    }
    const result = { pathname, searchParams };
    if (this.urlCache.size < 1000) {
      this.urlCache.set(url, result);
    }
    return result;
  }
  use(...args) {
    this.clearCaches();
    if (args.length === 1) {
      const [handler] = args;
      this.middlewares.push({
        match: () => ({ matched: true, params: {} }),
        handler
      });
    } else if (args.length === 2) {
      const [path, handler] = args;
      const segments = this.getPathSegments(path);
      const match = createPathMatcherSegments(segments);
      this.middlewares.push({
        path,
        pathPrefix: getStaticPrefix(path),
        match: (url) => match(this.getPathSegments(url)),
        handler
      });
    } else {
      const [method, path, handler] = args;
      const segments = this.getPathSegments(path);
      const match = createPathMatcherSegments(segments);
      this.middlewares.push({
        method,
        path,
        pathPrefix: getStaticPrefix(path),
        match: (url) => match(this.getPathSegments(url)),
        handler
      });
    }
    return this;
  }
  addRoute(method, path, ...handlers) {
    this.clearCaches();
    const segments = this.getPathSegments(path);
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
      match: (url) => matcher(this.getPathSegments(url))
    });
  }
  match(method, path) {
    const root = this.roots[method];
    if (!root)
      return null;
    const segments = this.getPathSegments(path);
    if (segments.length === 0) {
      return root.handlers ? { handlers: root.handlers, params: EMPTY_PARAMS } : null;
    }
    const params = {};
    let node = root;
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
      if (node.handlers) {
        return Object.keys(params).length === 0 ? { handlers: node.handlers, params: EMPTY_PARAMS } : { handlers: node.handlers, params };
      }
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
    const baseSegments = this.getPathSegments(path);
    for (const mw of scopedApp.middlewares) {
      const originalMatch = mw.match;
      const prefixedMatch = (url) => {
        const urlSegments = this.getPathSegments(url);
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
        path: path + (mw.path ?? ""),
        pathPrefix: getStaticPrefix(path + (mw.path ?? ""))
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
  createContext(req, params, parsedUrl) {
    const responseHeaders = new Headers;
    const ctx = {
      req,
      params,
      state: {},
      header: (name, value) => {
        responseHeaders.set(name, value);
      },
      set: (key, value) => {
        ctx.state[key] = value;
      },
      get: (key) => ctx.state[key],
      redirect: (url, status = 302) => {
        responseHeaders.set("Location", url);
        return new Response(null, {
          status,
          headers: responseHeaders
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
        const allHeaders = new Headers(responseHeaders);
        allHeaders.set("Content-Type", "application/json");
        if (headers) {
          Object.entries(headers).forEach(([name, value]) => {
            allHeaders.set(name, value);
          });
        }
        return new Response(JSON.stringify(data), {
          status,
          headers: allHeaders
        });
      },
      text: (data, status = 200, headers) => {
        const allHeaders = new Headers(responseHeaders);
        allHeaders.set("Content-Type", "text/plain");
        if (headers) {
          Object.entries(headers).forEach(([name, value]) => {
            allHeaders.set(name, value);
          });
        }
        return new Response(data, {
          status,
          headers: allHeaders
        });
      },
      html: (html, status = 200, headers) => {
        const allHeaders = new Headers(responseHeaders);
        allHeaders.set("Content-Type", "text/html; charset=utf-8");
        if (headers) {
          Object.entries(headers).forEach(([name, value]) => {
            allHeaders.set(name, value);
          });
        }
        return new Response(html, {
          status,
          headers: allHeaders
        });
      },
      query: () => parsedUrl.searchParams || EMPTY_SEARCH_PARAMS
    };
    return ctx;
  }
  async handle(req) {
    const method = req.method;
    const parsedUrl = this.parseUrl(req.url);
    const path = parsedUrl.pathname;
    try {
      const matched = this.match(method, path);
      if (!matched) {
        return new Response("Not Found", { status: 404 });
      }
      if (this.middlewares.length === 0 && matched.params === EMPTY_PARAMS && matched.handlers?.length === 1) {
        const ctx2 = this.createContext(req, EMPTY_PARAMS, parsedUrl);
        const result = await matched.handlers[0](ctx2, async () => {});
        return result instanceof Response ? result : new Response("No response returned by handler", { status: 500 });
      }
      if (this.middlewares.length === 0) {
        const ctx2 = this.createContext(req, matched.params, parsedUrl);
        for (const handler of matched.handlers || []) {
          const result = await handler(ctx2, async () => {});
          if (result instanceof Response) {
            return result;
          }
        }
        return new Response("No response returned by handler", { status: 500 });
      }
      const methodMiddlewares = this.getMethodMiddlewares(method);
      const middlewares = [];
      let finalParams = matched.params;
      if (methodMiddlewares.length > 0) {
        for (const mw of methodMiddlewares) {
          if (mw.pathPrefix && !path.startsWith(mw.pathPrefix)) {
            continue;
          }
          const matchResult = mw.match(path);
          if (matchResult.matched) {
            if (Object.keys(matchResult.params).length > 0) {
              if (finalParams === EMPTY_PARAMS) {
                finalParams = { ...matchResult.params };
              } else {
                finalParams = { ...finalParams, ...matchResult.params };
              }
            }
            middlewares.push(mw.handler);
          }
        }
      }
      const ctx = this.createContext(req, finalParams, parsedUrl);
      const stack = [...middlewares, ...matched.handlers ?? []];
      for (const fn of stack) {
        const result = await fn(ctx, async () => {});
        if (result instanceof Response) {
          return result;
        }
      }
      return new Response("No response returned by handler", { status: 500 });
    } catch (err) {
      if (this.errorHandler) {
        const errorCtx = {
          req,
          params: EMPTY_PARAMS,
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
          query: () => parsedUrl.searchParams || EMPTY_SEARCH_PARAMS,
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
function getStaticPrefix(path) {
  if (!path || path === "/")
    return "/";
  const segments = path.split("/").filter(Boolean);
  const staticSegments = [];
  for (const segment of segments) {
    if (segment.startsWith(":") || segment === "*") {
      break;
    }
    staticSegments.push(segment);
  }
  return staticSegments.length > 0 ? "/" + staticSegments.join("/") : "/";
}
function createPathMatcherSegments(segments) {
  const segmentCount = segments.length;
  return (urlSegments) => {
    if (urlSegments.length < segmentCount)
      return { matched: false, params: {} };
    const params = {};
    let hasParams = false;
    for (let i = 0;i < segmentCount; i++) {
      const seg = segments[i];
      const part = urlSegments[i];
      if (seg === "*")
        return { matched: true, params: hasParams ? params : {} };
      if (seg?.startsWith(":")) {
        if (!part)
          return { matched: false, params: {} };
        params[seg.slice(1)] = decodeURIComponent(part);
        hasParams = true;
      } else if (seg !== part) {
        return { matched: false, params: {} };
      }
    }
    const matched = urlSegments.length === segmentCount;
    return {
      matched,
      params: matched ? hasParams ? params : {} : {}
    };
  };
}
function joinPaths(...paths) {
  return "/" + paths.map((p) => p.replace(/^\/|\/$/g, "")).filter(Boolean).join("/");
}
export {
  Web
};
