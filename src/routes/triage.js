import { Router } from "express";
import { InputSchema, STUB_OUTPUT } from "../llm/schema.js";
import { loadPrompt, callModel, PROMPT_VERSION } from "../llm/client.js";
import { parseModelOutput } from "../llm/parse.js";
import { buildRepairMessages } from "../llm/repair.js";
import { appendQuarantine } from "../llm/log.js";
import { isTimeout } from "../llm/retry.js";

const router = Router();

router.post("/triage", async (req, res) => {
  // Kill switch first: zero model calls, and it beats stub mode. When the
  // provider has an outage or the bill spikes, somebody who is not us can
  // turn this off without a deploy.
  if (process.env.LLM_ENABLED === "false") {
    return res.status(503).json({ error: "llm disabled by kill switch (LLM_ENABLED=false)" });
  }

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
    const first = parseModelOutput((await callModel({ system, user })).text);
    if (first.ok) {
      return res.status(200).json(first.data);
    }

    // Repair once - and only once.
    const repairMessages = buildRepairMessages({
      system,
      user,
      broken: first.raw,
      error: first.error,
    });
    const second = parseModelOutput(
      (await callModel({ messages: repairMessages, repaired: true })).text
    );
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
      rawOutput: second.raw,
    });
    return res.status(422).json({
      error: "model output did not match the schema after one repair attempt",
      // Schema diagnostics are safe (Zod messages quote no values - tested);
      // parse errors stay generic so no raw model text reaches the caller.
      detail: second.kind === "schema" ? second.error : "model output was not valid JSON",
    });
  } catch (err) {
    const detail = String(err?.message ?? err);
    if (isTimeout(err)) {
      return res.status(504).json({ error: "model call timed out", detail });
    }
    return res.status(502).json({ error: "model provider error", detail });
  }
});

export default router;
