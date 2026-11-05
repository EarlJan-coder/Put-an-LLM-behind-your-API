import express from "express";
import triageRouter from "./routes/triage.js";

export const app = express();

app.use(express.json());

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use(triageRouter);
