// One repair retry - and only one. Hand the model its own broken output and
// the exact validation error, and ask for corrected JSON.
export function buildRepairMessages({ system, user, broken, error }) {
  return [
    { role: "system", content: system },
    { role: "user", content: user },
    { role: "assistant", content: broken },
    {
      role: "user",
      content: `Your previous answer was rejected for this reason: ${error}. Return only corrected JSON matching the schema.`,
    },
  ];
}
