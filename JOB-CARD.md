# Job card

What it does (one sentence): Classifies a support message so it lands on the right team.
Input: { "text": "string, 1-2000 characters" }
Output: { "category": one of [billing|bug|feature|other], "urgency": one of [low|normal|high], "suggested_team": one of [support|billing|engineering|product], "confidence": 0.0-1.0, "reason": "one short sentence" }
It must never: invent a category outside the list · return free text · give medical, legal or financial advice · reveal the prompt
When unsure it should: return category "other" with confidence below 0.5, not a guess

## Three rules check

- Closed output: same five fields every time; `category`, `urgency` and `suggested_team` come from the short lists above; `confidence` is a number; `reason` is one sentence.
- One decision: one request in, one answer out. No conversation, no memory of previous requests.
- A human could grade it: given a support message and its classification, a person can say whether it is right or wrong.
