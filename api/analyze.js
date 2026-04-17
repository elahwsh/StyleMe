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
        ? `Return JSON. Style this outfit toward ${celebrityName}. Profile: ${celebrityProfile}.`
        : `Return JSON. Style this outfit toward ${targetStyle}.`;

    const systemInstruction = `
Return JSON only.

You are a fashion stylist.

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
- Be short and specific
- No explanations
- JSON ONLY
`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",

        // ✅ THIS FIXES YOUR ERROR
        text: {
          format: { type: "json_object" }
        },

        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: systemInstruction }]
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
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    const outputText =
      data.output_text ??
      data.output
        ?.flatMap(item => item.content ?? [])
        ?.map(c => c.text || "")
        ?.join("")
        ?.trim();

    if (!outputText) {
      return res.status(500).json({ error: "No output text" });
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

    return res.status(200).json(parsed);

  } catch (err) {
    return res.status(500).json({
      error: err.message || "Server error"
    });
  }
}
