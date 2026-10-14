// JARVIS Worker. Serves the website and answers POST /api/chat using Google Gemini.
// Secrets (set in Cloudflare, never in this file):
//   GEMINI_API_KEY  your Gemini key
//   JARVIS_KEY      an access phrase you choose, so strangers can't use your quota
// Optional text variables:
//   AI_ENABLED      set to "false" to switch online AI off at the server (a real lockdown)
//   GEMINI_MODEL    model name to use (default below)

const SYSTEM =
  "You are J.A.R.V.I.S., a friendly, witty personal assistant and tutor. " +
  "Keep answers clear and fairly short. Explain science and maths simply. " +
  "Say so when you are unsure instead of guessing. If the user says something wrong, " +
  "correct them politely. Sometimes finish with one short question to check understanding. " +
  "Keep everything suitable for all ages.";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Everything except /api/chat is just the website.
    if (url.pathname !== "/api/chat") return env.ASSETS.fetch(request);

    if (request.method !== "POST") return json({ error: "Use POST." }, 405);

    // Server-side switch: set AI_ENABLED to "false" in Cloudflare to block all AI use.
    if (String(env.AI_ENABLED || "true").toLowerCase() === "false") {
      return json({ error: "Online AI is switched off at the server." }, 503);
    }

    // Only accept requests that come from this same site.
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return json({ error: "Not allowed." }, 403);

    // Access phrase check.
    if (!env.JARVIS_KEY || request.headers.get("x-jarvis-key") !== env.JARVIS_KEY) {
      return json({ error: "Not authorised." }, 401);
    }
    if (!env.GEMINI_API_KEY) {
      return json({ error: "The Gemini key isn't set up in Cloudflare yet." }, 500);
    }

    // Read and validate the request.
    const length = Number(request.headers.get("Content-Length") || 0);
    if (length > 20000) return json({ error: "Request too large." }, 413);
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Bad request." }, 400);
    }
    const question = String(body.q || "").trim().slice(0, 1500);
    if (!question) return json({ error: "Empty question." }, 400);

    const history = (Array.isArray(body.h) ? body.h : []).slice(-6).map((m) => ({
      role: m && m.r === "model" ? "model" : "user",
      parts: [{ text: String((m && m.t) || "").slice(0, 1500) }],
    }));

    const model = String(env.GEMINI_MODEL || "gemini-flash-lite-latest");
    if (!/^[a-z0-9.\-]+$/i.test(model)) return json({ error: "Bad model name." }, 500);

    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": env.GEMINI_API_KEY,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM }] },
            contents: [...history, { role: "user", parts: [{ text: question }] }],
            generationConfig: { maxOutputTokens: 700, temperature: 0.6 },
          }),
        }
      );
      if (!r.ok) {
        if (r.status === 404) return json({ error: "That model name wasn't found. Set GEMINI_MODEL in Cloudflare." }, 502);
        if (r.status === 429) return json({ error: "The free Gemini limit was reached. Try again later." }, 502);
        return json({ error: "Gemini refused the request (error " + r.status + ")." }, 502);
      }
      const data = await r.json();
      const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
      const answer = parts.map((p) => p.text || "").join("").trim();
      if (!answer) return json({ error: "The AI gave no answer (it may have been blocked)." }, 502);
      return json({ a: answer });
    } catch {
      return json({ error: "Couldn't reach Gemini." }, 502);
    }
  },
};
