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
You are VibeShop, an expert fashion search engine.

Your job:
1. Analyze the outfit image from a stylist point of view.
2. Identify each visible clothing piece.
3. Explain why the outfit works: silhouette, color, texture, and fit.
4. Create shopping queries that can recreate the same vibe as accurately as possible.
5. Make sure each suggested product would coordinate with the full outfit, not only match one item.

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
  "stylistNotes": {
    "silhouette": "why the outfit shape works",
    "colorLogic": "why the colors work together",
    "textureLogic": "why the materials/textures work together",
    "fitLogic": "why the fit/proportions work"
  },
  "shopFor": [
    {
      "query": "specific shopping search query",
      "category": "top | bottom | shoes | accessory | outerwear | other",
      "reason": "why this item coordinates with the full outfit",
      "tier": "budget | midRange | premium"
    }
  ]
}

Rules:
- Be specific: color, cut, fabric, fit, neckline, rise, length, heel type, etc.
- Do not include celebrity names in shopping queries.
- Do not say "similar" in the query.
- Queries should sound like real retail searches.
- Include visible pieces only.
- For every major category, create 2-3 shopping queries when possible.
- Include a mix of budget, midRange, and premium tiers.
- Product suggestions must coordinate together as one outfit.
- Avoid vague queries like "cute top" or "stylish pants".
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

    return res.status(200).json(normalizeVibeResponse(parsed));
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Vibe analysis failed"
    });
  }
}

function normalizeVibeResponse(data) {
  return {
    title: safeString(data.title, "Outfit Breakdown"),
    vibe: safeString(data.vibe, "Styled outfit"),
    colors: safeArray(data.colors),
    top: safeNullableString(data.top),
    bottom: safeNullableString(data.bottom),
    outerwear: safeNullableString(data.outerwear),
    shoes: safeNullableString(data.shoes),
    accessories: safeArray(data.accessories),
    stylistNotes: {
      silhouette: safeString(data?.stylistNotes?.silhouette, ""),
      colorLogic: safeString(data?.stylistNotes?.colorLogic, ""),
      textureLogic: safeString(data?.stylistNotes?.textureLogic, ""),
      fitLogic: safeString(data?.stylistNotes?.fitLogic, "")
    },
    shopFor: normalizeShopFor(data.shopFor)
  };
}

function normalizeShopFor(items) {
  if (!Array.isArray(items)) return [];

  return items
    .map(item => ({
      query: safeString(item.query, ""),
      category: normalizeCategory(item.category),
      reason: safeString(item.reason, "Coordinates with the outfit."),
      tier: normalizeTier(item.tier)
    }))
    .filter(item => item.query);
}

function normalizeCategory(value) {
  const allowed = new Set(["top", "bottom", "shoes", "accessory", "outerwear", "other"]);
  const clean = safeString(value, "other");
  return allowed.has(clean) ? clean : "other";
}

function normalizeTier(value) {
  const allowed = new Set(["budget", "midRange", "premium"]);
  const clean = safeString(value, "midRange");
  return allowed.has(clean) ? clean : "midRange";
}

function safeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function safeNullableString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(v => typeof v === "string" && v.trim()).map(v => v.trim());
}
