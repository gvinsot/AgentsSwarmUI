import cors from "cors";
import express from "express";

export function buildContentSecurityPolicy() {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' ws: wss: https://api.openai.com",
    "script-src 'self'",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
  ].join("; ");
}

export function createApp({
  allowedOrigin = process.env.CLIENT_URL || "*",
} = {}) {
  const app = express();

  app.use(
    cors({
      origin: allowedOrigin,
    }),
  );

  app.use((req, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    res.setHeader(
      "Cross-Origin-Resource-Policy",
      allowedOrigin === "*" ? "cross-origin" : "same-site",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "microphone=(self), camera=()");
    res.setHeader("Content-Security-Policy", buildContentSecurityPolicy());
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  return app;
}