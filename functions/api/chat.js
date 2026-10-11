

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.GEMINI_API_KEY) {
    return Response.json(
      { error: "Gemini API key is not configured in Cloudflare." },
      { status: 500 }
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid request." },
      { status: 400 }
    );
  }

  const message =
    typeof body.message === "string"
      ? body.message.trim()
      : "";

  if (!message || message.length > 8000) {
    return Response.json(
      { error: "Message must be between 1 and 8000 characters." },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{
              text: "You are JARVIS, a helpful, intelligent AI assistant. Be clear, friendly, and concise. Never claim to control the user's device or security systems."
            }]
          },
          contents: [{
            role: "user",
            parts: [{ text: message }]
          }]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return Response.json(
        { error: "Gemini request failed. Check the API key and model access." },
        { status: 502 }
      );
    }

    const reply = data.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    if (!reply) {
      return Response.json(
        { error: "Gemini returned an empty response." },
        { status: 502 }
      );
    }

    return Response.json({ reply });
  } catch {
    return Response.json(
      { error: "Could not connect to Gemini." },
      { status: 502 }
    );
  }
}

