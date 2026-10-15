'use strict';
// Optional localhost preview, including the lab-only preference worker.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const {createPreferenceQueue} = require('./interaction-lab/preference-queue.js');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.md':'text/plain; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.wasm':'application/wasm'};
function createServer(options = {}) {
  const root = fs.realpathSync(options.rootDir || __dirname);
  const queue = options.queue || createPreferenceQueue({...options, rootDir: root});
  const json = (res, code, data) => { res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(data)); };
  const server = http.createServer(async (req, res) => {
    let url, pathname;
    try { url = new URL(req.url, 'http://localhost'); pathname = decodeURIComponent(url.pathname); }
    catch (_) { res.writeHead(400); res.end('Invalid path'); return; }
    if (pathname.startsWith('/api/preferences/')) {
      let hostname;
      try { hostname = new URL('http://' + req.headers.host).hostname; } catch (_) { hostname = ''; }
      if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) { json(res, 403, {error:'Preference writes require a loopback host.'}); return; }
      const origin = req.headers.origin;
      if (origin && origin !== 'http://' + req.headers.host) { json(res, 403, {error:'Local preferences require the same browser origin.'}); return; }
      if (req.headers['sec-fetch-site'] === 'cross-site') { json(res, 403, {error:'Cross-site preference requests are forbidden.'}); return; }
      try {
        await queue.ready;
        if (pathname === '/api/preferences/status' && req.method === 'GET') { json(res, 200, queue.status(url.searchParams.get('workspaceId'))); return; }
        if (pathname === '/api/preferences/commits' && req.method === 'POST') {
          if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) { json(res, 415, {error:'Use application/json for committed preferences.'}); return; }
          const declared = Number(req.headers['content-length']);
          if (declared > 12 * 1024 * 1024) { json(res, 413, {error:'Preference batch is too large.'}); req.resume(); return; }
          const chunks = []; let bytes = 0;
          for await (const chunk of req) { bytes += chunk.length; if (bytes > 12 * 1024 * 1024) throw Object.assign(new Error('Preference batch is too large.'), {statusCode:413}); chunks.push(chunk); }
          let payload; try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { throw Object.assign(new Error('Invalid JSON commit request.'), {statusCode:400}); }
          json(res, 202, await queue.enqueue(payload)); return;
        }
        json(res, 405, {error:'Unsupported preference API method or path.'}); return;
      } catch (error) { json(res, error.statusCode || 500, {error:error.message}); return; }
    }
    const relative = pathname === '/' ? 'interaction-lab.html' : pathname.replace(/^\/+/, ''), file = path.resolve(root, relative);
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    if (relative.split(/[\\/]/).some(part => part.startsWith('.'))) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.realpath(file, (error, real) => {
      if (error || !real.startsWith(root + path.sep)) { res.writeHead(404); res.end('Not found'); return; }
      fs.readFile(real, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, {'Content-Type':types[path.extname(real)] || 'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(data);
      });
    });
  });
  server.preferenceQueue = queue;
  server.once('close', () => queue.close());
  return server;
}
module.exports = {createServer};
if (require.main === module) {
  const port = Number(process.env.FEEL_LAB_PORT) || 8787;
  createServer().listen(port, '127.0.0.1', () => console.log('Feel interaction lab: http://127.0.0.1:' + port + '/interaction-lab.html'));
}
