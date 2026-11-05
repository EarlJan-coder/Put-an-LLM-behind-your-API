import express from "express";
import triageRouter from "./routes/triage.js";

export const app = express();

app.use(express.json());

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use(triageRouter);

// Garbage input is rejected before any model call - including a body that
// is not even valid JSON. Callers get JSON, never a stack trace.
app.use((err, req, res, next) => {
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "invalid JSON body", field: "(body)" });
  }
  return res.status(500).json({ error: "internal error" });
});
