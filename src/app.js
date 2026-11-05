import express from "express";
import triageRouter from "./routes/triage.js";

export const app = express();

app.use(express.json());

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use(triageRouter);

// Garbage input is rejected before any model call - including a body that is
// not even valid JSON. Client mistakes get 4xx; callers get JSON, never a
// stack trace; unexpected errors are logged server-side before the 500.
export function errorHandler(err, req, res, next) {
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "invalid JSON body", field: "(body)" });
  }
  if (err?.type === "entity.too.large" || err?.status === 413) {
    return res.status(413).json({ error: "request body too large", field: "(body)" });
  }
  if (err?.status >= 400 && err?.status < 500) {
    return res.status(err.status).json({ error: err.message || "bad request", field: "(body)" });
  }
  console.error(err);
  return res.status(500).json({ error: "internal error" });
}

app.use(errorHandler);
