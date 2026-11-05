import { OutputSchema } from "./schema.js";

// Model output is untrusted input. Extract the JSON object from whatever
// the model actually said (code fences, prose, trailing text), then validate
// it against the schema before anything downstream may see it.
export function parseModelOutput(raw) {
  const text = String(raw ?? "");

  const unfenced = text.replace(/```[a-zA-Z]*/g, "").replace(/```/g, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    return { ok: false, error: "no JSON object found in model output", raw: text };
  }

  let parsed;
  try {
    parsed = JSON.parse(unfenced.slice(start, end + 1));
  } catch (err) {
    return { ok: false, error: `model output is not valid JSON: ${err.message}`, raw: text };
  }

  const result = OutputSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".") || "(body)"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `schema validation failed: ${detail}`, raw: text };
  }

  return { ok: true, data: result.data };
}
