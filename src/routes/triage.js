import { Router } from "express";
import { InputSchema, STUB_OUTPUT } from "../llm/schema.js";

const router = Router();

router.post("/triage", (req, res) => {
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

  return res.status(501).json({ error: "model pipeline arrives in stage 2" });
});

export default router;
