import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const correctionsPath = join(root, "output", "corrections.json");

function correctionsPlugin(): Plugin {
  return {
    name: "corrections-api",
    configureServer(server) {
      server.middlewares.use(
        "/api/corrections",
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          if (req.method === "GET") {
            mkdirSync(join(root, "output"), { recursive: true });
            const body = existsSync(correctionsPath)
              ? readFileSync(correctionsPath, "utf8")
              : "[]";
            res.setHeader("Content-Type", "application/json");
            res.end(body);
            return;
          }
          if (req.method === "POST") {
            let raw = "";
            req.on("data", (c: Buffer) => {
              raw += c.toString();
            });
            req.on("end", () => {
              try {
                const entry = JSON.parse(raw) as Record<string, unknown>;
                mkdirSync(join(root, "output"), { recursive: true });
                const existing = existsSync(correctionsPath)
                  ? (JSON.parse(
                      readFileSync(correctionsPath, "utf8"),
                    ) as unknown[])
                  : [];
                existing.push({ ...entry, ts: new Date().toISOString() });
                writeFileSync(
                  correctionsPath,
                  JSON.stringify(existing, null, 2) + "\n",
                );
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ ok: true, count: existing.length }));
              } catch (e) {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, error: String(e) }));
              }
            });
            return;
          }
          next();
        },
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), correctionsPlugin()],
  server: { port: 5173 },
});
