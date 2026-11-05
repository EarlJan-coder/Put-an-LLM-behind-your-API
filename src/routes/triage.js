import { Router } from "express";
import { InputSchema, STUB_OUTPUT } from "../llm/schema.js";
import { loadPrompt, callModel, PROMPT_VERSION } from "../llm/client.js";
import { parseModelOutput } from "../llm/parse.js";
import { buildRepairMessages } from "../llm/repair.js";
import { appendQuarantine } from "../llm/log.js";

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

  const input = parsed.data;
  const system = loadPrompt();
  // Untrusted input travels only in the user role, JSON-encoded so it
  // cannot break out of its own quotes (prompt-injection defence).
  const user = JSON.stringify({ text: input.text });

  try {
    const raw = await callModel({ system, user });
    const first = parseModelOutput(raw);
    if (first.ok) {
      return res.status(200).json(first.data);
    }

    // Repair once - and only once.
    const repairMessages = buildRepairMessages({
      system,
      user,
      broken: raw,
      error: first.error,
    });
    const raw2 = await callModel({ messages: repairMessages });
    const second = parseModelOutput(raw2);
    if (second.ok) {
      return res.status(200).json(second.data);
    }

    // Give up cleanly: quarantine the raw output, answer 422. Never guess a
    // default and never return raw model text.
    appendQuarantine({
      ts: new Date().toISOString(),
      input,
      promptVersion: PROMPT_VERSION,
      error: second.error,
      rawOutput: raw2,
    });
    return res.status(422).json({
      error: "model output did not match the schema after one repair attempt",
      detail: second.error,
    });
  } catch (err) {
    return res.status(500).json({
      error: "model call failed",
      detail: String(err?.message ?? err),
    });
  }
});

export default router;
