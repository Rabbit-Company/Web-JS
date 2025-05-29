// src/index.ts
class TrieNode {
  segment;
  children = new Map;
  paramChild;
  wildcardChild;
  handlers;
  method;
  routeId;
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
  matcherCache = new Map;
  routeMatchCache = new Map;
  idCounter = 0;
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
  generateId() {
    return `${Date.now()}-${++this.idCounter}`;
  }
  clearCaches() {
    this.methodMiddlewareCache.clear();
    this.urlCache.clear();
    this.segmentCache.clear();
    this.routeMatchCache.clear();
  }
  rebuildTrie() {
    this.roots = {
      GET: new TrieNode,
      POST: new TrieNode,
      PUT: new TrieNode,
      DELETE: new TrieNode,
      PATCH: new TrieNode,
      OPTIONS: new TrieNode,
      HEAD: new TrieNode
    };
    for (const route of this.routes) {
      this.addRouteToTrie(route.method, route.path, route.handlers, route.id);
    }
  }
  addRouteToTrie(method, path, handlers, routeId) {
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
    node.routeId = routeId;
  }
  errorHandler;
  onError(handler) {
    this.errorHandler = handler;
    return this;
  }
  getPathSegments(path) {
    let segments = this.segmentCache.get(path);
    if (segments)
      return segments;
    segments = path.split("/").filter(Boolean);
    if (this.segmentCache.size < 1000) {
      this.segmentCache.set(path, segments);
    }
    return segments;
  }
  parseUrl(url) {
    const cached = this.urlCache.get(url);
    if (cached)
      return cached;
    if (url[0] === "/" && !url.includes("?") && !url.includes("#")) {
      const result2 = { pathname: url, searchParams: undefined };
      if (this.urlCache.size < 2000) {
        this.urlCache.set(url, result2);
      }
      return result2;
    }
    const queryStart = url.indexOf("?");
    const hashStart = url.indexOf("#");
    let pathnameEnd = url.length;
    if (queryStart !== -1)
      pathnameEnd = Math.min(pathnameEnd, queryStart);
    if (hashStart !== -1)
      pathnameEnd = Math.min(pathnameEnd, hashStart);
    let pathname;
    const protocolEnd = url.indexOf("://");
    if (protocolEnd !== -1) {
      const hostStart = protocolEnd + 3;
      const pathStart = url.indexOf("/", hostStart);
      pathname = pathStart !== -1 ? url.slice(pathStart, pathnameEnd) : "/";
    } else {
      pathname = url.slice(0, pathnameEnd) || "/";
    }
    let searchParams;
    if (queryStart !== -1) {
      const queryEnd = hashStart !== -1 ? hashStart : url.length;
      const queryString = url.slice(queryStart + 1, queryEnd);
      if (queryString.length > 0) {
        searchParams = new URLSearchParams(queryString);
      }
    }
    const result = { pathname, searchParams };
    if (this.urlCache.size >= 2000) {
      const firstKey = this.urlCache.keys().next().value;
      if (firstKey !== undefined)
        this.urlCache.delete(firstKey);
    }
    this.urlCache.set(url, result);
    return result;
  }
  use(...args) {
    this.addMiddleware(...args);
    return this;
  }
  removeMiddleware(id) {
    const initialLength = this.middlewares.length;
    this.middlewares = this.middlewares.filter((mw) => mw.id !== id);
    if (this.middlewares.length !== initialLength) {
      this.clearCaches();
      return true;
    }
    return false;
  }
  removeMiddlewareBy(criteria) {
    const initialLength = this.middlewares.length;
    if (!criteria.method && !criteria.path)
      return 0;
    this.middlewares = this.middlewares.filter((mw) => {
      if (criteria.method && mw.method !== criteria.method)
        return true;
      if (criteria.path && mw.path !== criteria.path)
        return true;
      return false;
    });
    const removedCount = initialLength - this.middlewares.length;
    if (removedCount > 0) {
      this.clearCaches();
    }
    return removedCount;
  }
  addMiddleware(...args) {
    this.clearCaches();
    const id = this.generateId();
    if (args.length === 1) {
      const [handler] = args;
      this.middlewares.push({
        id,
        match: () => ({ matched: true, params: {} }),
        handler
      });
    } else if (args.length === 2) {
      const [path, handler] = args;
      const segments = this.getPathSegments(path);
      const match = this.getCachedMatcher(path, segments);
      this.middlewares.push({
        id,
        path,
        pathPrefix: getStaticPrefix(path),
        match: (url) => match(this.getPathSegments(url)),
        handler
      });
    } else {
      const [method, path, handler] = args;
      const segments = this.getPathSegments(path);
      const match = this.getCachedMatcher(path, segments);
      this.middlewares.push({
        id,
        method,
        path,
        pathPrefix: getStaticPrefix(path),
        match: (url) => match(this.getPathSegments(url)),
        handler
      });
    }
    return id;
  }
  getMiddlewares() {
    return this.middlewares.map((mw) => ({
      id: mw.id,
      method: mw.method,
      path: mw.path
    }));
  }
  getCachedMatcher(path, segments) {
    let matcher = this.matcherCache.get(path);
    if (!matcher) {
      matcher = createPathMatcherSegments(segments);
      this.matcherCache.set(path, matcher);
    }
    return matcher;
  }
  addRoute(method, path, ...handlers) {
    this.clearCaches();
    const id = this.generateId();
    this.addRouteToTrie(method, path, handlers, id);
    const matcher = this.getCachedMatcher(path, this.getPathSegments(path));
    this.routes.push({
      id,
      method,
      path,
      handlers,
      match: (url) => matcher(this.getPathSegments(url))
    });
    return id;
  }
  removeRoute(id) {
    const initialLength = this.routes.length;
    this.routes = this.routes.filter((route) => route.id !== id);
    if (this.routes.length !== initialLength) {
      this.clearCaches();
      this.rebuildTrie();
      return true;
    }
    return false;
  }
  removeRoutesBy(criteria) {
    const initialLength = this.routes.length;
    if (!criteria.method && !criteria.path)
      return 0;
    this.routes = this.routes.filter((route) => {
      if (criteria.method && route.method !== criteria.method)
        return true;
      if (criteria.path && route.path !== criteria.path)
        return true;
      return false;
    });
    const removedCount = initialLength - this.routes.length;
    if (removedCount > 0) {
      this.clearCaches();
      this.rebuildTrie();
    }
    return removedCount;
  }
  getRoutes() {
    return this.routes.map((route) => ({
      id: route.id,
      method: route.method,
      path: route.path
    }));
  }
  clear() {
    this.routes = [];
    this.middlewares = [];
    this.clearCaches();
    this.rebuildTrie();
  }
  match(method, path) {
    const cacheKey = `${method}:${path}`;
    const cached = this.routeMatchCache.get(cacheKey);
    if (cached !== undefined)
      return cached;
    const root = this.roots[method];
    if (!root) {
      this.routeMatchCache.set(cacheKey, null);
      return null;
    }
    const segments = this.getPathSegments(path);
    if (segments.length === 0) {
      const result = root.handlers ? { handlers: root.handlers, params: EMPTY_PARAMS } : null;
      if (this.routeMatchCache.size < 500) {
        this.routeMatchCache.set(cacheKey, result);
      }
      return result;
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
      if (this.routeMatchCache.size < 500) {
        this.routeMatchCache.set(cacheKey, null);
      }
      return null;
    }
    if (i === segments.length || node.segment === "*") {
      if (node.handlers) {
        const result = Object.keys(params).length === 0 ? { handlers: node.handlers, params: EMPTY_PARAMS } : { handlers: node.handlers, params };
        if (this.routeMatchCache.size < 500) {
          this.routeMatchCache.set(cacheKey, result);
        }
        return result;
      }
    }
    if (this.routeMatchCache.size < 500) {
      this.routeMatchCache.set(cacheKey, null);
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
        id: this.generateId(),
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
    const state = {};
    const ctx = {
      req,
      params,
      state,
      header: (name, value) => {
        responseHeaders.set(name, value);
      },
      set: (key, value) => {
        state[key] = value;
      },
      get: (key) => state[key],
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
        const allHeaders = headers ? new Headers(responseHeaders) : responseHeaders;
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
        const allHeaders = headers ? new Headers(responseHeaders) : responseHeaders;
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
        const allHeaders = headers ? new Headers(responseHeaders) : responseHeaders;
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
        const handlers2 = matched.handlers;
        if (handlers2) {
          for (let i = 0;i < handlers2.length; i++) {
            const result = await handlers2[i](ctx2, async () => {});
            if (result instanceof Response) {
              return result;
            }
          }
        }
        return new Response("No response returned by handler", { status: 500 });
      }
      const methodMiddlewares = this.getMethodMiddlewares(method);
      let finalParams = matched.params;
      const middlewares = new Array(methodMiddlewares.length);
      let middlewareCount = 0;
      if (methodMiddlewares.length > 0) {
        for (let i = 0;i < methodMiddlewares.length; i++) {
          const mw = methodMiddlewares[i];
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
            middlewares[middlewareCount++] = mw.handler;
          }
        }
      }
      const ctx = this.createContext(req, finalParams, parsedUrl);
      const handlers = matched.handlers;
      const totalHandlers = middlewareCount + (handlers?.length || 0);
      if (totalHandlers === 0) {
        return new Response("No response returned by handler", { status: 500 });
      }
      for (let i = 0;i < middlewareCount; i++) {
        const result = await middlewares[i](ctx, async () => {});
        if (result instanceof Response) {
          return result;
        }
      }
      if (handlers) {
        for (let i = 0;i < handlers.length; i++) {
          const result = await handlers[i](ctx, async () => {});
          if (result instanceof Response) {
            return result;
          }
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
            headers: new Headers({ "Content-Type": "application/json" })
          }),
          html: (html, status = 500) => new Response(html, {
            status,
            headers: new Headers({ "Content-Type": "text/html; charset=utf-8" })
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
  const hasWildcard = segments[segmentCount - 1] === "*";
  const paramPositions = [];
  for (let i = 0;i < segmentCount; i++) {
    if (segments[i].startsWith(":")) {
      paramPositions.push({ index: i, name: segments[i].slice(1) });
    }
  }
  const hasParams = paramPositions.length > 0;
  return (urlSegments) => {
    if (!hasWildcard && urlSegments.length !== segmentCount) {
      return { matched: false, params: {} };
    }
    if (hasWildcard && urlSegments.length < segmentCount - 1) {
      return { matched: false, params: {} };
    }
    if (!hasParams && !hasWildcard) {
      for (let i = 0;i < segmentCount; i++) {
        if (segments[i] !== urlSegments[i]) {
          return { matched: false, params: {} };
        }
      }
      return { matched: true, params: {} };
    }
    const params = {};
    for (let i = 0;i < segmentCount; i++) {
      const seg = segments[i];
      const part = urlSegments[i];
      if (seg === "*") {
        params["*"] = urlSegments.slice(i).join("/");
        return { matched: true, params };
      }
      if (seg.startsWith(":")) {
        if (!part)
          return { matched: false, params: {} };
        params[seg.slice(1)] = decodeURIComponent(part);
      } else if (seg !== part) {
        return { matched: false, params: {} };
      }
    }
    const matched = urlSegments.length === segmentCount;
    return {
      matched,
      params: matched ? params : {}
    };
  };
}
function joinPaths(...paths) {
  let result = "/";
  for (let i = 0;i < paths.length; i++) {
    const p = paths[i];
    if (p && p !== "/") {
      let start = 0;
      let end = p.length;
      if (p[0] === "/")
        start++;
      if (p[end - 1] === "/")
        end--;
      if (end > start) {
        if (result !== "/")
          result += "/";
        result += p.slice(start, end);
      }
    }
  }
  return result;
}
export {
  Web
};
