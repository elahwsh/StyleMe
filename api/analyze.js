// api/analyze.js

function normalizeScore(score) {
  if (score == null || Number.isNaN(Number(score))) return 0;
  const numeric = Math.round(Number(score));
  if (numeric > 0 && numeric <= 10) return Math.min(100, numeric * 10);
  return Math.max(0, Math.min(100, numeric));
}

function safeArray(value, max = 4) {
  return Array.isArray(value)
    ? value
        .map(item => (typeof item === "string" ? item.trim() : item))
        .filter(Boolean)
        .slice(0, max)
    : [];
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanKeepSwapConflicts(keep, swap) {
  return swap.filter(item => {
    const from = normalizeText(item.from).toLowerCase();
    if (!from) return false;

    return !keep.some(k => {
      const kept = normalizeText(k).toLowerCase();
      return kept && (kept.includes(from) || from.includes(kept));
    });
  });
}

function normalizeShopFor(value) {
  if (!Array.isArray(value)) return [];

  const allowedCategories = new Set([
    "tops",
    "pants",
    "shoes",
    "outerwear",
    "accessories",
    "dresses",
    "other"
  ]);

  return value
    .filter(
      item =>
        item &&
        typeof item.query === "string" &&
        typeof item.reason === "string"
    )
    .map(item => {
      const category = normalizeText(item.category || "other").toLowerCase();

      return {
        query: normalizeText(item.query),
        reason: normalizeText(item.reason),
        category: allowedCategories.has(category) ? category : "other"
      };
    })
    .filter(item => item.query && item.reason)
    .slice(0, 6);
}

function extractTags(result) {
  const tags = [];

  result.swap?.forEach(item => {
    if (item?.to) tags.push(item.to);
  });

  result.add?.forEach(item => {
    if (typeof item === "string") tags.push(item);
  });

  result.shopFor?.forEach(item => {
    if (item?.query) tags.push(item.query);
  });

  if (tags.length < 3) {
    result.keep?.forEach(item => {
      if (typeof item === "string") tags.push(item);
    });
  }

  return [
    ...new Set(
      tags
        .map(tag => normalizeText(tag).toLowerCase())
        .filter(Boolean)
    )
  ].slice(0, 8);
}

function buildFallbackResult(isCelebrity) {
  return {
    score: 65,
    detectedVibe: "Casual everyday outfit",
    colors: ["white", "grey"],
    materials: ["cotton", "jersey"],
    styleTags: ["casual", "minimal", "relaxed"],
    keep: ["white fitted top"],
    swap: [
      {
        from: "grey sweatpants",
        to: "straight-leg tailored trousers",
        why: "The sweatpants make the outfit feel too lounge-based; structured trousers create a cleaner styled look."
      }
    ],
    add: ["small shoulder bag", "simple hoop earrings", "sleek sunglasses"],
    avoid: ["mixing lounge bottoms with polished accessories"],
    styleDirections: [
      "Keep the fitted top, but elevate the base with structured bottoms.",
      "Use minimal accessories that stay within the white and grey palette."
    ],
    shopFor: [
      {
        query: "women's grey straight leg tailored trousers",
        reason: "Replaces the lounge bottom with a polished base.",
        category: "pants"
      },
      {
        query: "women's black pointed ankle boots block heel",
        reason: "Adds a sleek shoe that makes the outfit feel intentional.",
        category: "shoes"
      },
      {
        query: "women's black mini shoulder bag",
        reason: "Finishes the outfit without cluttering it.",
        category: "accessories"
      },
      {
        query: "women's silver small hoop earrings",
        reason: "Adds a clean minimal accessory.",
        category: "accessories"
      },
      {
        query: "women's narrow black sunglasses",
        reason: "Adds a model-off-duty styling detail.",
        category: "accessories"
      }
    ],
    celebrityInspoQueries: isCelebrity
      ? [
          "celebrity model off duty fitted white top tailored trousers",
          "celebrity street style white crop top straight trousers",
          "celebrity black shoulder bag narrow sunglasses outfit",
          "celebrity casual chic tailored pants outfit"
        ]
      : []
  };
}

function extractOutputText(data) {
  if (typeof data?.output_text === "string") {
    return data.output_text.trim();
  }

  const text =
    data?.output
      ?.flatMap(item => item.content || [])
      ?.map(content => content.text || "")
      ?.join("")
      ?.trim() || "";

  return text;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    const {
      mode = "style",
      targetStyle = "Casual Chic",
      celebrityName = "",
      celebrityProfile = "",
      imageBase64
    } = req.body || {};

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return res.status(400).json({ error: "Missing imageBase64" });
    }

    const isCelebrity = mode === "celebrity";

    const userText = isCelebrity
      ? `Analyze the uploaded outfit and restyle it toward ${celebrityName || "the selected celebrity"}. Celebrity profile: ${celebrityProfile || "Use recognizable celebrity fashion logic only when it supports a wearable outfit."}`
      : `Analyze the uploaded outfit and style it toward ${targetStyle || "Casual Chic"}.`;

    const systemInstruction = `
Return JSON only. No markdown. No extra text.

You are a professional fashion stylist with formal fashion knowledge.
You must build wearable, cohesive, realistic looks.

Output exact JSON:
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
    { "query": "", "reason": "", "category": "" }
  ],
  "celebrityInspoQueries": []
}

CRITICAL RULES:
- Build one clear aesthetic.
- Do not mix incompatible aesthetics.
- Do not pair sporty lounge pieces with classy, glam, tailored, luxury, or editorial pieces.
- If the current outfit is too casual for the target style, swap the casual base item first.
- Do not simply add fancy pieces on top of a weak base outfit.
- Fix the base outfit first, then add finishing accessories.
- Suggestions must be wearable, intentional, realistic, and specific.
- No body shaming.
- No attractiveness ratings.

STYLE CONSISTENCY:
- Avoid sporty + classy.
- Avoid gymwear + formal.
- Avoid lounge + luxury tailoring.
- Avoid athletic polyester + wool tailoring.
- Avoid casual sneakers with glam or elegant looks unless target is intentionally casual.
- Use one main vibe only.

SILHOUETTE:
- Fitted top works with relaxed or tailored bottoms.
- Oversized top needs slimmer or structured bottoms.
- Cropped top with low-rise sweatpants is very casual; for elevated styling, swap bottoms.
- Wide-leg tailored pants, straight trousers, structured denim, mini skirts, or sleek boots can elevate a simple top.
- Avoid bulky-on-bulky unless intentionally streetwear.

COLOR:
- Use 2 to 3 main colors.
- Prefer monochrome, tonal, neutral plus accent, or clean contrast.
- Avoid random color additions.

ACCESSORIES:
- Suggest 1 to 3 accessories max.
- Accessories must support the outfit.
- Good options: narrow sunglasses, shoulder bags, hoop earrings, layered necklaces, belts, watches, hair clips, scarves, sleek handbags.

CELEBRITY MODE:
- Adapt toward the celebrity while preserving only items that truly work.
- Do not preserve an item just because it exists.
- If an item blocks the celebrity style, swap it.
- Bella Hadid/model-off-duty: fitted tops, tailored trousers, low-rise or straight-leg bottoms, narrow sunglasses, shoulder bags, pointed boots, loafers, appropriate leather jackets, simple jewelry.
- Hailey Bieber: clean basics, oversized blazer, straight jeans/trousers, loafers, clean sneakers, gold hoops, sleek shoulder bag.
- Dove Cameron: dark romantic styling, corset shapes, mini skirts or tailored pants, black boots, silver jewelry.
- Kendall Jenner: sleek minimal styling, fitted tops, straight trousers, pointed boots/heels, simple bags.
- Rihanna: bold coherent styling, statement outerwear, luxury streetwear only when base supports it.
- Zendaya: polished editorial tailoring, strong silhouette, refined accessories.

KEEP/SWAP:
- keep max 3.
- swap max 1.
- Never keep and swap the same item.
- If sweatpants, gym leggings, athletic shorts, or very casual sneakers clash with target style, swap them.
- add max 4.
- avoid max 2.
- styleDirections exactly 2 short professional directions.

SHOPPING:
- shopFor must include 5 to 6 items.
- Include one base clothing item if needed.
- Include one shoe item.
- Include one bag or jewelry item.
- Include one styling accessory.
- Include one optional finishing piece.
- Queries must be specific and product-search friendly.
- Category must be exactly one of:
  "tops", "pants", "shoes", "outerwear", "accessories", "dresses", "other"

LIMITS:
- colors max 4.
- materials max 4.
- styleTags max 4.
- celebrityInspoQueries exactly 4 only if celebrity mode, otherwise [].
`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 40000);

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
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
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      console.error("OpenAI API error:", data);
      return res.status(response.status).json({
        error: data?.error?.message || "OpenAI request failed",
        raw: data
      });
    }

    const outputText = extractOutputText(data);

    if (!outputText) {
      console.error("No OpenAI output:", data);
      const fallback = buildFallbackResult(isCelebrity);
      fallback.tagsToMatch = extractTags(fallback);
      return res.status(200).json(fallback);
    }

    let parsed;

    try {
      parsed = JSON.parse(outputText);
    } catch (error) {
      console.error("Invalid JSON from model:", outputText);
      const fallback = buildFallbackResult(isCelebrity);
      fallback.tagsToMatch = extractTags(fallback);
      return res.status(200).json(fallback);
    }

    const keep = safeArray(parsed.keep, 3).map(String);

    let swap = Array.isArray(parsed.swap)
      ? parsed.swap
          .filter(
            item =>
              item &&
              typeof item.from === "string" &&
              typeof item.to === "string" &&
              typeof item.why === "string"
          )
          .map(item => ({
            from: normalizeText(item.from),
            to: normalizeText(item.to),
            why: normalizeText(item.why)
          }))
          .filter(item => item.from && item.to && item.why)
          .slice(0, 1)
      : [];

    swap = cleanKeepSwapConflicts(keep, swap);

    const result = {
      score: normalizeScore(parsed.score),
      detectedVibe: normalizeText(parsed.detectedVibe),
      colors: safeArray(parsed.colors, 4).map(String),
      materials: safeArray(parsed.materials, 4).map(String),
      styleTags: safeArray(parsed.styleTags, 4).map(String),
      keep,
      swap,
      add: safeArray(parsed.add, 4).map(String),
      avoid: safeArray(parsed.avoid, 2).map(String),
      styleDirections: safeArray(parsed.styleDirections, 2).map(String),
      shopFor: normalizeShopFor(parsed.shopFor),
      celebrityInspoQueries: isCelebrity
        ? safeArray(parsed.celebrityInspoQueries, 4).map(String)
        : []
    };

    if (result.shopFor.length < 5) {
      const fallback = buildFallbackResult(isCelebrity);
      result.shopFor = fallback.shopFor;
    }

    result.tagsToMatch = extractTags(result);

    return res.status(200).json(result);
  } catch (error) {
    console.error("FULL ANALYZE ERROR:", error);

    return res.status(500).json({
      error:
        error?.name === "AbortError"
          ? "OpenAI request timed out"
          : error?.message || "Server error"
    });
  }
}
