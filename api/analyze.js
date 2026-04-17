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
        ? `You are styling this user toward a celebrity reference.

Celebrity: ${celebrityName}
Celebrity style profile: ${celebrityProfile}

Analyze the actual outfit in the photo.
Be concrete.
Say what can stay, what must be swapped, what should be added, what to avoid, and how to restyle this exact outfit toward that celebrity.`
        : `You are styling this user toward the target style: ${targetStyle}.

Analyze the actual outfit in the photo.
Be concrete.
Say what can stay, what must be swapped, what should be added, what to avoid, and how to restyle this exact outfit toward the target style.`;

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
- score must be an integer from 0 to 100
- detectedVibe should describe the outfit as it currently reads
- keep = exact things that still work and can stay
- swap = exact piece-by-piece replacements, not generic advice
- add = exact missing pieces or accessories
- avoid = exact things that cheapen or break the target style
- styleDirections = 3 short specific styling paths for this exact outfit
- shopFor = 3 useful shopping queries the app can later turn into product cards
- do not mention body type, torso, proportions, skin tone, or attractiveness
- do not output markdown
- do not output explanations outside JSON
- make the advice stylist-level, not generic ChatGPT summary language

Good example of specific advice:
- keep the black shorts
- swap the sporty running sneaker for a low-profile leather sneaker
- add a cropped leather jacket
- style the same shorts with a fitted ribbed tank and narrow sunglasses

Bad example:
- elevate the look
- choose premium footwear
- add luxury accessories
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
      keep: Array.isArray(parsed.keep) ? parsed.keep.slice(0, 4) : [],
      swap: Array.isArray(parsed.swap)
        ? parsed.swap
            .filter(item => item && typeof item.from === "string" && typeof item.to === "string" && typeof item.why === "string")
            .slice(0, 4)
        : [],
      add: Array.isArray(parsed.add) ? parsed.add.slice(0, 4) : [],
      avoid: Array.isArray(parsed.avoid) ? parsed.avoid.slice(0, 4) : [],
      styleDirections: Array.isArray(parsed.styleDirections) ? parsed.styleDirections.slice(0, 3) : [],
      shopFor: Array.isArray(parsed.shopFor)
        ? parsed.shopFor
            .filter(item => item && typeof item.query === "string" && typeof item.reason === "string")
            .slice(0, 3)
        : []
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Server error"
    });
  }
}
