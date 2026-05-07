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
You are VibeShop, a fashion search engine that recreates outfit photos as accurately as possible.

Analyze the outfit image from a professional stylist and fashion buyer point of view.

Your job:
1. Identify every visible clothing category.
2. Describe each item with exact color, fit, fabric, texture, length, silhouette, and pattern.
3. Create precise shopping queries that search for the SAME item style, not just something vaguely similar.
4. Return shopping queries for ALL visible categories: top, bottom, outerwear, shoes, and accessories.

Return ONLY valid JSON in this exact shape:

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
    "textureLogic": "why the materials/textures work together",
    "fitLogic": "why the fit/proportions work"
  },
  "shopFor": [
    {
      "query": "exact shopping query",
      "category": "top | bottom | shoes | accessory | outerwear | other",
      "reason": "why this item matches the exact photo",
      "tier": "budget | midRange | premium"
    }
  ]
}

CRITICAL RULES:
- You MUST include shopFor queries for every visible category.
- If outerwear is visible, include outerwear.
- If shoes are visible, include shoes.
- If a bag, glasses, belt, jewelry, or purse is visible, include accessory.
- First query for each category must be the closest possible match.
- Second query can be a slightly broader acceptable alternative.
- Do NOT suggest different garment types.
- Do NOT suggest different lengths.
- Do NOT suggest patterns when the original is solid.
- Do NOT suggest plaid, satin, midi, pencil, pleated, or knit skirts unless the image clearly shows that.
- If the image shows a solid charcoal gray ultra mini straight skirt, the query must include: charcoal gray, ultra mini, straight, solid, no pattern.
- If the image shows a blazer, include color, structure, button style, fit, and fabric texture if visible.
- If the image shows shoes, include color, shape, sole, heel/platform, and shoe type.
- If the image shows a bag, include color, shape, strap type, and hardware if visible.
- Keep product queries short but specific.
- Do not include celebrity names in shopping queries.
- Do not use vague words like cute, trendy, stylish, aesthetic, vibe, or similar in the query.
- Use retail-searchable terms only.

GOOD query examples:
- "camel brown fitted scoop neck ribbed tank top solid"
- "charcoal gray ultra mini straight tailored skirt solid no pattern"
- "charcoal gray structured single breasted blazer fitted"
- "beige monogram platform loafers chunky sole"
- "burgundy structured shoulder bag gold hardware"

BAD query examples:
- "gray skirt"
- "cute mini skirt"
- "Bella Hadid skirt"
- "fashion blazer"
- "similar outfit"
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
  const normalized = {
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

  normalized.shopFor = addMissingCategoryQueries(normalized);

  return normalized;
}

function addMissingCategoryQueries(data) {
  const existing = Array.isArray(data.shopFor) ? data.shopFor : [];
  const categories = new Set(existing.map(item => item.category));

  const added = [...existing];

  if (data.top && !categories.has("top")) {
    added.push({
      query: exactifyQuery(data.top),
      category: "top",
      reason: "Matches the visible top in the photo.",
      tier: "midRange"
    });
  }

  if (data.bottom && !categories.has("bottom")) {
    added.push({
      query: exactifyQuery(data.bottom),
      category: "bottom",
      reason: "Matches the visible bottom in the photo.",
      tier: "midRange"
    });
  }

  if (data.outerwear && !categories.has("outerwear")) {
    added.push({
      query: exactifyQuery(data.outerwear),
      category: "outerwear",
      reason: "Matches the visible outerwear in the photo.",
      tier: "midRange"
    });
  }

  if (data.shoes && !categories.has("shoes")) {
    added.push({
      query: exactifyQuery(data.shoes),
      category: "shoes",
      reason: "Matches the visible shoes in the photo.",
      tier: "midRange"
    });
  }

  if (Array.isArray(data.accessories) && data.accessories.length > 0 && !categories.has("accessory")) {
    data.accessories.slice(0, 3).forEach(accessory => {
      added.push({
        query: exactifyQuery(accessory),
        category: "accessory",
        reason: "Matches the visible accessory in the photo.",
        tier: "midRange"
      });
    });
  }

  return added.slice(0, 14);
}

function exactifyQuery(text) {
  const clean = safeString(text, "");

  if (!clean) return "";

  const lower = clean.toLowerCase();

  let additions = [];

  if (
    lower.includes("solid") ||
    lower.includes("plain") ||
    lower.includes("no pattern")
  ) {
    additions.push("solid no pattern");
  }

  if (
    lower.includes("mini") ||
    lower.includes("micro") ||
    lower.includes("short skirt")
  ) {
    additions.push("ultra mini straight");
  }

  if (
    lower.includes("tailored") ||
    lower.includes("structured")
  ) {
    additions.push("tailored structured");
  }

  const merged = `${clean} ${additions.join(" ")}`.trim();

  return dedupeWords(merged);
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
