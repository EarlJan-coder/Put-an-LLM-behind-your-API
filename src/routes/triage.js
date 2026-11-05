import { Router } from "express";
import { InputSchema, STUB_OUTPUT } from "../llm/schema.js";
import { loadPrompt, callModel } from "../llm/client.js";

const router = Router();

router.post("/triage", async (req, res) => {
  const parsed = InputSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({
      error: issue.message,
      field: issue.path.join(".") || "(body)",
    });
  }

  // Stub mode: skip the model entirely, answer with a schema-valid constant.
  if (process.env.LLM_STUB === "1") {
    return res.status(200).json(STUB_OUTPUT);
  }

  try {
    const system = loadPrompt();
    // Untrusted input travels only in the user role, JSON-encoded so it
    // cannot break out of its own quotes (prompt-injection defence).
    const user = JSON.stringify({ text: parsed.data.text });
    const text = await callModel({ system, user });
    // Stage 2 only: raw model text. Stage 3 replaces this with parse/validate.
    return res.status(200).type("text/plain").send(text);
  } catch (err) {
    return res.status(500).json({
      error: "model call failed",
      detail: String(err?.message ?? err),
    });
  }
});

export default router;
