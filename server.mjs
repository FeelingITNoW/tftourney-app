// Production server. Wraps Next.js only so `//riot.txt` (the double-slash URL
// Riot verifies against) is served directly: Next.js 308-redirects any
// double-slash path before proxy.ts or config can intercept it.
import { createServer } from "node:http";
import next from "next";

const port = Number(process.env.PORT) || 3000;
const hostname = process.env.HOSTNAME || "0.0.0.0";
const dev = process.env.NODE_ENV !== "production";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((req, res) => {
    if (req.url === "//riot.txt" || req.url.startsWith("//riot.txt?")) {
      req.url = req.url.slice(1);
    }
    handle(req, res);
  }).listen(port, hostname, () => {
    console.log(`Ready on http://${hostname}:${port}`);
  });
});
