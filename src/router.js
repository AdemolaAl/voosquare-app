'use strict';

class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler, opts = {}) {
    const keys = [];
    const src = pattern.replace(/\/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }).replace(/\/\*$/, '(?:/.*)?');
    this.routes.push({ method, re: new RegExp('^' + src + '/?$'), keys, handler, opts });
  }
  get(p, h, o) { this.add('GET', p, h, o); }
  post(p, h, o) { this.add('POST', p, h, o); }
  put(p, h, o) { this.add('PUT', p, h, o); }
  patch(p, h, o) { this.add('PATCH', p, h, o); }
  del(p, h, o) { this.add('DELETE', p, h, o); }
  match(method, pathname) {
    const m2 = method === 'HEAD' ? 'GET' : method;
    for (const r of this.routes) {
      if (r.method !== m2) continue;
      const m = r.re.exec(pathname);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1]); } catch { params[k] = m[i + 1]; } });
      return { route: r, params };
    }
    return null;
  }
}

module.exports = { Router };
