// Tiny static file server for local play: `node serve.js` then open http://localhost:8123
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8123;
const types ={ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
  const file = path.resolve(__dirname, rel);
  if (!file.startsWith(__dirname + path.sep) || file.includes('node_modules')) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Sinkhole City on http://localhost:${PORT}`));
