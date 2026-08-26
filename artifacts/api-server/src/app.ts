import path from "path";
import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/auth-middleware";

declare const __dirname: string;

const app: Express = express();

// Read allowed origins from env. Comma-separated list. If not set, allow common localhost dev origins.
const rawAllowed = process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000";
const allowedOrigins = rawAllowed.split(",").map((s) => s.trim()).filter(Boolean);

function originValidator(origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) {
  if (!origin) return cb(null, true); // allow non-browser clients like curl, server-to-server
  if (allowedOrigins.includes(origin)) return cb(null, true);
  return cb(new Error("Origin not allowed"));
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors({ credentials: true, origin: originValidator }));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);

// Mount health router if present
try {
  // health router is a standalone router file
  // @ts-ignore - optional require in case the file is not present
  import("./routes/health").then((mod) => app.use("/api", (mod.default || mod)));
} catch {
  // ignore
}

// If a routes/index exists, mount it; otherwise router above is minimal.
app.use("/api", router);

// Serve the built frontend (artifacts/tastekin/dist/public) and fall back to
// its index.html for any non-API route, so this single process serves the
// whole app in production (Replit Autoscale expects one process per deployment).
const publicDir = path.resolve(__dirname, "../../tastekin/dist/public");
app.use(express.static(publicDir));
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

export default app;
