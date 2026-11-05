import { z } from "zod";

export const InputSchema = z.object({
  text: z.string().trim().min(1).max(2000),
});

export const OutputSchema = z.object({
  category: z.enum(["billing", "bug", "feature", "other"]),
  urgency: z.enum(["low", "normal", "high"]),
  suggested_team: z.enum(["support", "billing", "engineering", "product"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(200),
});

export const STUB_OUTPUT = {
  category: "bug",
  urgency: "high",
  suggested_team: "engineering",
  confidence: 0.9,
  reason: "The message reports something broken and asks for a fix.",
};
