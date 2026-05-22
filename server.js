import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./public", import.meta.url));
const port = Number(process.env.PORT || 8171);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function isSafeHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function readUrl(req, res) {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 20_000) req.destroy();
  });
  req.on("end", async () => {
    try {
      const { url } = JSON.parse(body || "{}");
      if (!isSafeHttpUrl(url)) {
        sendJson(res, 400, { error: "Bitte eine gültige http/https URL eingeben." });
        return;
      }

      const response = await fetch(url, {
        redirect: "follow",
        headers: {
          "user-agent": "Landingpage App Builder/1.0",
          accept: "text/html, text/plain, application/json;q=0.9, */*;q=0.8",
        },
      });
      const contentType = response.headers.get("content-type") || "";
      const text = await response.text();
      sendJson(res, response.ok ? 200 : 502, {
        ok: response.ok,
        status: response.status,
        url: response.url,
        contentType,
        text: text.slice(0, 500_000),
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message || "URL konnte nicht gelesen werden." });
    }
  });
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const cleanPath = normalize(decodeURIComponent(requestUrl.pathname)).replace(/^(\.\.[/\\])+/, "");
  const path = cleanPath === "/" ? "/index.html" : cleanPath;
  const filePath = join(root, path);

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "content-type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    res.end(content);
  } catch {
    const index = await readFile(join(root, "index.html"));
    res.writeHead(200, { "content-type": mimeTypes[".html"] });
    res.end(index);
  }
}

createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/read-url") {
    readUrl(req, res);
    return;
  }
  serveStatic(req, res);
}).listen(port, () => {
  console.log(`Landingpage App Builder läuft auf http://127.0.0.1:${port}`);
});
