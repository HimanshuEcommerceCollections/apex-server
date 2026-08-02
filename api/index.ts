// Vercel serverless entry point. Exposes the Express app as the request handler
// for every route (see vercel.json rewrites). Local dev and non-serverless hosts
// (e.g. Render) still use `npm run dev` / `npm start`, which run src/server.ts
// and call app.listen(). Vercel never runs a long-lived listener.
//
// createApp() validates env at import time — if a required variable
// (DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, …) is missing, the
// function crashes on cold start and every route returns 500. Set them all in
// the Vercel project's Environment Variables.
import { createApp } from "../src/app";

const app = createApp();

export default app;
