import { app } from "./app.js";

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`triage api listening on http://localhost:${port}`);
});
