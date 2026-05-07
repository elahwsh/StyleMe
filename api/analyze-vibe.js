export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    const { imageUrl, title } = req.body || {};

    if (!imageUrl) {
      return res.status(400).json({ error: "Missing imageUrl" });
    }

    const prompt = `
You are VibeShop, a fashion search engine that turns outfit inspiration into shoppable clothing breakdowns.

Analyze this outfit image and break it into shoppable clothing pieces.

Return ONLY valid JSON in this exact shape:

{
  "title": "short outfit title",
  "vibe": "short aesthetic vibe",
  "colors": ["color 1", "color 2"],
  "top": "specific top description or null",
  "bottom": "specific bottom description or null",
  "outerwear": "specific outerwear description or null",
  "shoes": "specific shoes description or null",
  "accessories": ["specific accessory 1"],
  "shopFor": [
    {
      "query": "specific shopping search query",
      "category": "top | bottom | shoes | accessory | outerwear | other",
      "reason": "why this item matches the look"
    }
  ]
}

Rules:
- Be specific enough for shopping.
- Do not say "similar".
- Do not include celebrity names in product queries.
- Product queries should be realistic retail searches.
- Include only visible or strongly implied items.
- Keep each product query short and searchable.
`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `${prompt}\nImage title: ${title || ""}`
              },
              {
                type: "input_image",
                image_url: imageUrl
              }
            ]
          }
        ],
        text: {
          format: {
            type: "json_object"
          }
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || "OpenAI request failed"
      });
    }

    const text =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text ||
      "{}";

    const parsed = JSON.parse(text);

    return res.status(200).json(parsed);
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Vibe analysis failed"
    });
  }
}
