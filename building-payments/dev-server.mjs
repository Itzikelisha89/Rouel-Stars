// Local test server: serves public/ and runs the API function against a local Blobs server.
// Usage: ADMIN_PASSWORD=test1234 node dev-server.mjs [blobsDir]
import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { BlobsServer } from "@netlify/blobs/server";

const dir = process.argv[2] || ".blobs-local";
const token = "local";
const blobs = new BlobsServer({ directory: dir, port: 8971, token });
await blobs.start();
process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ edgeURL: "http://localhost:8971", uncachedEdgeURL: "http://localhost:8971", siteID: "local", token })).toString("base64");
globalThis.Netlify = { env: { get: (k) => process.env[k] } };
const { default: handler } = await import("./netlify/functions/api.mts");

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:8888");
  if (url.pathname.startsWith("/api/")) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks);
    const request = new Request(url, { method: req.method, headers: req.headers, body });
    const jar = Object.fromEntries((req.headers.cookie || "").split(/;\s*/).filter(Boolean).map((c) => [c.split("=")[0], c.slice(c.indexOf("=") + 1)]));
    const r = await handler(request, { ip: "127.0.0.1", cookies: { get: (n) => jar[n] } });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  const p = url.pathname === "/" ? "/index.html" : url.pathname;
  try {
    const data = await readFile(join("public", p));
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404); res.end("not found"); }
}).listen(8888, () => console.log("http://localhost:8888"));
