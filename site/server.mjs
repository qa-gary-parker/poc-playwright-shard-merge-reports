import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('./index.html', import.meta.url));
createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(page)).listen(3000, '127.0.0.1');
