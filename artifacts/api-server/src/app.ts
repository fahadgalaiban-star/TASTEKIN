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

// Replit (and most PaaS) terminate TLS at a single edge proxy in front of this
// process. Trusting exactly one hop lets Express's own req.protocol/req.hostname
// safely honor X-Forwarded-Proto/X-Forwarded-Host from that proxy, instead of
// route handlers reading those headers raw and unvalidated.
app.set("trust proxy", 1);

// Read allowed origins from env. Comma-separated list. If not set, allow common localhost dev origins.
const rawAllowed = process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000";
const allowedOrigins = rawAllowed.split(",").map((s) => s.trim()).filter(Boolean);

// A per-request options delegate (the shape `cors` expects when origin
// decisions need the request itself, per its "Configuring CORS w/ Dynamic
// Origin" API) rather than a plain `{ origin: fn(origin, cb) }` object,
// since deciding "is this my own current host" needs req.protocol/req.host.
function corsOptionsDelegate(req: express.Request, cb: (err: Error | null, options?: cors.CorsOptions) => void) {
  const origin = req.header("Origin");
  if (!origin) { cb(null, { credentials: true, origin: true }); return; } // non-browser clients like curl, server-to-server
  if (allowedOrigins.includes(origin)) { cb(null, { credentials: true, origin: true }); return; }
  // A request whose Origin exactly matches the host this request itself
  // arrived on is never actually cross-origin — this single process serves
  // both the built frontend and /api (see the static/catch-all handler
  // below), so in production the app calling its own API always has
  // Origin === this host. Trusting that self-origin means a fresh Replit
  // preview/deployment domain (which changes independently of any
  // ALLOWED_ORIGINS secret, and which rejecting it would otherwise break)
  // works without any manual configuration step, while a genuinely
  // different origin (an attacker's site) can never satisfy this check — a
  // browser sets Origin from the page's real origin, not from anything the
  // request itself can spoof.
  const selfOrigin = `${req.protocol}://${req.get("host")}`;
  if (origin === selfOrigin) { cb(null, { credentials: true, origin: true }); return; }
  // Deny (origin: false), not an error: the cors package turns a callback
  // error into a thrown error that skips every other middleware and lands
  // on the generic 500 handler, turning an ordinary "this origin isn't
  // allowed" policy decision into an opaque "Internal server error" for
  // every route, including signup/login — masking the real cause in logs
  // and in the client. `origin: false` instead just omits the CORS
  // headers, so the browser itself blocks the disallowed origin from
  // reading the response (the actual security boundary), while a
  // same-origin request, a redirect-based navigation, or a non-browser
  // caller is never affected either way.
  cb(null, { credentials: true, origin: false });
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

app.use(cors(corsOptionsDelegate));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);

app.use("/api", router);

// Any request under /api that no route above matched is a real 404, not the
// SPA shell — answer it as JSON so API clients (and platform health probes
// hitting an unexpected /api path) get an unambiguous, cheap response
// instead of falling through to sendFile below.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Serve the built frontend (artifacts/tastekin/dist/public) and fall back to
// its index.html for any non-API route, so this single process serves the
// whole app in production (Replit Autoscale expects one process per deployment).
const publicDir = path.resolve(__dirname, "../../tastekin/dist/public");
app.use(express.static(publicDir));
app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// Last-resort error handler: anything an individual route didn't already
// catch and translate into its own JSON response lands here. Always log the
// full error server-side and always answer with a generic, secret-free JSON
// body — never leak stack traces, query text, or connection details to the
// client, and never let Express's default HTML error page (which is what a
// deployment health-checker sees as an opaque 500) be the last word.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  (req.log ?? logger).error({ err, method: req.method, url: req.url?.split("?")[0] }, "Unhandled request error");
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
});

export default app;
