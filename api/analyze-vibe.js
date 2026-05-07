const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      return res.status(200).json({
        ok: true,
        message: "analyze-vibe endpoint is live. Use POST with { imageUrl, title }."
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({
        error: "Method not allowed"
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "Missing GEMINI_API_KEY"
      });
    }

    const { imageUrl, title } = req.body || {};

    if (!imageUrl) {
      return res.status(400).json({
        error: "Missing imageUrl"
      });
    }

    const prompt = `
You are VibeShop, a fashion search engine.

Analyze this outfit image like an elite stylist and fashion buyer.

Return ONLY valid JSON. No markdown. No explanation.

JSON shape:

{
  "title": "short outfit title",
  "vibe": "short aesthetic vibe",
  "colors": ["color 1", "color 2"],
  "top": "exact top description or null",
  "bottom": "exact bottom description or null",
  "outerwear": "exact outerwear description or null",
  "shoes": "exact shoes description or null",
  "accessories": ["exact accessory 1"],
  "stylistNotes": {
    "silhouette": "why the outfit shape works",
    "colorLogic": "why the colors work together",
    "textureLogic": "why the textures/fabrics work together",
    "fitLogic": "why the proportions and fit work"
  },
  "shopFor": [
    {
      "query": "exact retail shopping query",
      "category": "top",
      "reason": "why this matches the photo",
      "tier": "midRange"
    }
  ]
}

Required categories:
- top
- bottom
- outerwear
- shoes
- accessory

Rules:
- Include all visible categories.
- If outerwear is visible, include outerwear.
- If shoes are visible, include shoes.
- If a bag, sunglasses, belt, necklace, earrings, or jewelry is visible, include accessory.
- First query for each category must be the closest possible match.
- Use exact color, fit, length, material, texture, silhouette, and pattern.
- If item is solid, include "solid" or "no pattern".
- Do not suggest different garment types.
- Do not suggest different lengths.
- Do not suggest patterned items when original is solid.
- Do not include celebrity names in shopping queries.
- Do not use vague words like cute, trendy, stylish, aesthetic, vibe, or similar.
- Generate 1–2 shopping queries per visible category.
- If top and bottom are same material/color, create matching set queries.
- For denim-on-denim outfits, top and bottom queries must include the same wash color.
- Add "same wash", "matching denim set", and exact color terms when the look relies on matching denim.
- Prefer same-store/same-brand set results when possible.
Good queries:
- "dark blue denim strapless corset top button front"
- "dark blue low rise wide leg baggy jeans"
- "white oversized button up shirt cotton"
- "black narrow oval sunglasses"
- "white quilted shoulder bag chain strap"
`;

    const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `${prompt}\nImage title: ${title || ""}`
              },
              {
                fileData: {
                  mimeType: "image/jpeg",
                  fileUri: imageUrl
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json"
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || "Gemini request failed",
        raw: data
      });
    }

    let rawText =
      data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

    rawText = rawText
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    let parsed = {};

    try {
      parsed = JSON.parse(rawText);
    } catch (parseError) {
      return res.status(500).json({
        error: "AI returned invalid JSON",
        raw: rawText
      });
    }

    const normalized = normalizeVibeResponse(parsed);

    return res.status(200).json(normalized);
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Vibe analysis failed"
    });
  }
}

function normalizeVibeResponse(data) {
  const normalized = {
    title: safeString(data.title, "Outfit Breakdown"),
    vibe: safeString(data.vibe, "Fashion Outfit"),
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

  normalized.shopFor = addMissingCategoryQueries(normalized);

  return normalized;
}

function normalizeShopFor(items) {
  if (!Array.isArray(items)) return [];

  return items
    .map(item => ({
      query: exactifyQuery(safeString(item.query, "")),
      category: normalizeCategory(item.category),
      reason: safeString(item.reason, "Matches the exact outfit photo."),
      tier: normalizeTier(item.tier)
    }))
    .filter(item => item.query);
}

function addMissingCategoryQueries(data) {
  const existing = Array.isArray(data.shopFor) ? [...data.shopFor] : [];
  const categories = new Set(existing.map(item => item.category));

  if (data.top && !categories.has("top")) {
    existing.push({
      query: exactifyQuery(data.top),
      category: "top",
      reason: "Matches the visible top in the photo.",
      tier: "midRange"
    });
  }

  if (data.bottom && !categories.has("bottom")) {
    existing.push({
      query: exactifyQuery(data.bottom),
      category: "bottom",
      reason: "Matches the visible bottom in the photo.",
      tier: "midRange"
    });
  }

  if (data.outerwear && !categories.has("outerwear")) {
    existing.push({
      query: exactifyQuery(data.outerwear),
      category: "outerwear",
      reason: "Matches the visible outerwear in the photo.",
      tier: "midRange"
    });
  }

  if (data.shoes && !categories.has("shoes")) {
    existing.push({
      query: exactifyQuery(data.shoes),
      category: "shoes",
      reason: "Matches the visible shoes in the photo.",
      tier: "midRange"
    });
  }

  if (
    Array.isArray(data.accessories) &&
    data.accessories.length > 0 &&
    !categories.has("accessory")
  ) {
    data.accessories.slice(0, 3).forEach(accessory => {
      existing.push({
        query: exactifyQuery(accessory),
        category: "accessory",
        reason: "Matches the visible accessory in the photo.",
        tier: "midRange"
      });
    });
  }

  return existing.slice(0, 14);
}

function exactifyQuery(text) {
  const clean = safeString(text, "");

  if (!clean) return "";

  const lower = clean.toLowerCase();
  const additions = [];

  if (
    lower.includes("plain") ||
    lower.includes("solid") ||
    lower.includes("no pattern")
  ) {
    additions.push("solid no pattern");
  }

  if (
    lower.includes("mini") ||
    lower.includes("micro") ||
    lower.includes("short skirt")
  ) {
    additions.push("mini");
  }

  if (
    lower.includes("structured") ||
    lower.includes("tailored")
  ) {
    additions.push("structured tailored");
  }

  return dedupeWords(`${clean} ${additions.join(" ")}`.trim());
}

function normalizeCategory(value) {
  const clean = safeString(value, "other").toLowerCase();

  if (clean === "tops") return "top";
  if (clean === "bottoms") return "bottom";
  if (clean === "accessories") return "accessory";

  const allowed = new Set([
    "top",
    "bottom",
    "shoes",
    "accessory",
    "outerwear",
    "other"
  ]);

  return allowed.has(clean) ? clean : "other";
}

function normalizeTier(value) {
  const clean = safeString(value, "midRange");

  const allowed = new Set([
    "budget",
    "midRange",
    "premium"
  ]);

  return allowed.has(clean) ? clean : "midRange";
}

function safeString(value, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function safeNullableString(value) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function safeArray(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter(v => typeof v === "string" && v.trim())
    .map(v => v.trim());
}

function dedupeWords(text) {
  const words = text.split(/\s+/);
  const seen = new Set();
  const result = [];

  for (const word of words) {
    const key = word.toLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      result.push(word);
    }
  }

  return result.join(" ");
}
