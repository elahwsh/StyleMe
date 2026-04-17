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
        ? `Analyze this outfit photo against this celebrity style profile.

Celebrity: ${celebrityName}
Profile: ${celebrityProfile}

Return strict JSON only.`
        : `Analyze this outfit photo for the target style: ${targetStyle}.

Return strict JSON only.`;

    const schemaInstruction = `
You are a fashion outfit analysis assistant.

Return strict JSON only with this exact shape:
{
  "score": 0,
  "detectedVibe": "",
  "colors": [],
  "materials": [],
  "styleTags": [],
  "strengths": [],
  "suggestions": []
}

Rules:
- score must be an integer from 0 to 100
- colors, materials, styleTags are arrays of short strings
- strengths must contain exactly 2 short strings
- suggestions must contain exactly 3 short strings
- do not mention body type, torso, proportions, or skin tone
- do not include markdown
- do not include explanations outside JSON
`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: schemaInstruction
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: userText
              },
              {
                type: "input_image",
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
      colors: Array.isArray(parsed.colors) ? parsed.colors : [],
      materials: Array.isArray(parsed.materials) ? parsed.materials : [],
      styleTags: Array.isArray(parsed.styleTags) ? parsed.styleTags : [],
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 2) : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 3) : []
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Server error"
    });
  }
}
