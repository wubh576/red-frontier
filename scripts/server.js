"use strict";
// Optional local preview. The game itself also runs directly from index.html.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const projectRoot = path.resolve(__dirname, "..");
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles/game.css", ["styles/game.css", "text/css; charset=utf-8"]],
  ["/src/engine.js", ["src/engine.js", "text/javascript; charset=utf-8"]],
  ["/src/game.js", ["src/game.js", "text/javascript; charset=utf-8"]],
]);
const port = Number(process.env.PORT || 8765);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be an integer from 1 to 65535.");
const server = http.createServer((req, res) => {
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }
  let pathname;
  try {
    pathname = new URL(req.url, "http://127.0.0.1").pathname;
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  const file = files.get(pathname);
  if (!file) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  fs.readFile(path.join(projectRoot, file[0]), (error, content) => {
    if (error) {
      res.writeHead(500);
      res.end("Unable to read game files");
      return;
    }
    res.writeHead(200, {
      "Content-Type": file[1],
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : content);
  });
});
server.on("error", (error) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `Port ${port} is in use. Try PORT=8766 npm start.`
      : error.message,
  );
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Red Frontier: http://127.0.0.1:${port}\nLocal only. Press Ctrl+C to stop.`,
  ),
);
