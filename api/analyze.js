function normalizeScore(score) {
  if (score == null || Number.isNaN(Number(score))) return 0;
  const numeric = Math.round(Number(score));
  if (numeric > 0 && numeric <= 10) return Math.min(100, numeric * 10);
  return Math.max(0, Math.min(100, numeric));
}

function safeArray(value, max = 4) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { mode, targetStyle, celebrityName, celebrityProfile, imageBase64 } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    if (!imageBase64) {
      return res.status(400).json({ error: "Missing imageBase64" });
    }

    const userText =
      mode === "celebrity"
        ? `Return JSON. Style this outfit toward ${celebrityName}. Celebrity profile: ${celebrityProfile}. Be specific, fast, and concise.`
        : `Return JSON. Style this outfit toward ${targetStyle}. Be specific, fast, and concise.`;

    const systemInstruction = `
Return JSON only.

You are a premium fashion stylist.

Output EXACT JSON format:

{
  "score": 0,
  "detectedVibe": "",
  "colors": [],
  "materials": [],
  "styleTags": [],
  "keep": [],
  "swap": [
    { "from": "", "to": "", "why": "" }
  ],
  "add": [],
  "avoid": [],
  "styleDirections": [],
  "shopFor": [
    { "query": "", "reason": "" }
  ]
}

Rules:
- Be short and specific.
- Score must be 0 to 100.
- Keep max 3 items.
- Swap max 2 items.
- Add max 3 items.
- Avoid max 2 items.
- StyleDirections exactly 2 short directions.
- ShopFor exactly 3 short shopping queries.
- Do not mention body type, torso, proportions, skin tone, or attractiveness.
- No markdown.
- No explanations outside JSON.
`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        text: {
          format: { type: "json_object" }
        },
        input: [
          {
            role: "system",
            content: [
              { type: "input_text", text: systemInstruction }
            ]
          },
          {
            role: "user",
            content: [
              { type: "input_text", text: userText },
              {
                type: "input_image",
                detail: "low",
                image_url: `data:image/jpeg;base64,${imageBase64}`
              }
            ]
          }
        ]
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    const outputText =
      data.output_text ??
      data.output
        ?.flatMap(item => item.content ?? [])
        ?.map(content => content.text || "")
        ?.join("")
        ?.trim();

    if (!outputText) {
      return res.status(500).json({
        error: "No output text returned from OpenAI",
        raw: data
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      return res.status(500).json({
        error: "Invalid JSON from model",
        raw: outputText
      });
    }

    return res.status(200).json({
      score: normalizeScore(parsed.score),
      detectedVibe: typeof parsed.detectedVibe === "string" ? parsed.detectedVibe : "",
      colors: safeArray(parsed.colors, 4),
      materials: safeArray(parsed.materials, 4),
      styleTags: safeArray(parsed.styleTags, 4),
      keep: safeArray(parsed.keep, 3),
      swap: Array.isArray(parsed.swap)
        ? parsed.swap
            .filter(item =>
              item &&
              typeof item.from === "string" &&
              typeof item.to === "string" &&
              typeof item.why === "string"
            )
            .slice(0, 2)
        : [],
      add: safeArray(parsed.add, 3),
      avoid: safeArray(parsed.avoid, 2),
      styleDirections: safeArray(parsed.styleDirections, 2),
      shopFor: Array.isArray(parsed.shopFor)
        ? parsed.shopFor
            .filter(item =>
              item &&
              typeof item.query === "string" &&
              typeof item.reason === "string"
            )
            .slice(0, 3)
        : []
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.name === "AbortError" ? "OpenAI request timed out" : (error?.message || "Server error")
    });
  }
}
