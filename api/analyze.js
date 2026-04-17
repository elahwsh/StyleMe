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
        ? `Style this outfit toward ${celebrityName}. Celebrity profile: ${celebrityProfile}. Be specific and concise.`
        : `Style this outfit toward ${targetStyle}. Be specific and concise.`;

    const schemaInstruction = `
You are a premium fashion stylist.

Return strict JSON only with this exact shape:
{
  "score": 0,
  "detectedVibe": "",
  "colors": [],
  "materials": [],
  "styleTags": [],
  "keep": [],
  "swap": [
    {
      "from": "",
      "to": "",
      "why": ""
    }
  ],
  "add": [],
  "avoid": [],
  "styleDirections": [],
  "shopFor": [
    {
      "query": "",
      "reason": ""
    }
  ]
}

Rules:
- Be fast and concise.
- Score must be an integer from 0 to 100.
- keep: max 3 items.
- swap: max 2 items.
- add: max 3 items.
- avoid: max 2 items.
- styleDirections: exactly 2 short styling directions.
- shopFor: exactly 3 shopping queries.
- Do not mention body type, torso, proportions, skin tone, or attractiveness.
- Do not output markdown.
- Do not output explanations outside JSON.
- Make swaps concrete, not generic.
`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35000);

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        instructions: schemaInstruction,
        text: {
          format: {
            type: "json_object"
          }
        },
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: userText
              },
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
        error: "Failed to parse JSON from model output",
        outputText
      });
    }

    return res.status(200).json({
      score: Number.isInteger(parsed.score) ? parsed.score : 0,
      detectedVibe: typeof parsed.detectedVibe === "string" ? parsed.detectedVibe : "",
      colors: Array.isArray(parsed.colors) ? parsed.colors.slice(0, 4) : [],
      materials: Array.isArray(parsed.materials) ? parsed.materials.slice(0, 4) : [],
      styleTags: Array.isArray(parsed.styleTags) ? parsed.styleTags.slice(0, 4) : [],
      keep: Array.isArray(parsed.keep) ? parsed.keep.slice(0, 3) : [],
      swap: Array.isArray(parsed.swap)
        ? parsed.swap
            .filter(item => item && typeof item.from === "string" && typeof item.to === "string" && typeof item.why === "string")
            .slice(0, 2)
        : [],
      add: Array.isArray(parsed.add) ? parsed.add.slice(0, 3) : [],
      avoid: Array.isArray(parsed.avoid) ? parsed.avoid.slice(0, 2) : [],
      styleDirections: Array.isArray(parsed.styleDirections) ? parsed.styleDirections.slice(0, 2) : [],
      shopFor: Array.isArray(parsed.shopFor)
        ? parsed.shopFor
            .filter(item => item && typeof item.query === "string" && typeof item.reason === "string")
            .slice(0, 3)
        : []
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.name === "AbortError" ? "OpenAI request timed out" : (error?.message || "Server error")
    });
  }
}
