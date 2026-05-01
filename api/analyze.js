// api/analyze.js

function normalizeScore(score) {
  if (score == null || Number.isNaN(Number(score))) return 0;
  const numeric = Math.round(Number(score));
  if (numeric > 0 && numeric <= 10) return Math.min(100, numeric * 10);
  return Math.max(0, Math.min(100, numeric));
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeArray(value, max = 4) {
  return Array.isArray(value)
    ? value
        .map(item => (typeof item === "string" ? item.trim() : item))
        .filter(Boolean)
        .slice(0, max)
    : [];
}

function normalizeCategory(value) {
  const category = normalizeText(value).toLowerCase();

  const allowed = new Set([
    "tops",
    "pants",
    "shoes",
    "outerwear",
    "accessories",
    "dresses",
    "other"
  ]);

  return allowed.has(category) ? category : "other";
}

function normalizeShopFor(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      item =>
        item &&
        typeof item.query === "string" &&
        typeof item.reason === "string"
    )
    .map(item => ({
      query: normalizeText(item.query),
      reason: normalizeText(item.reason),
      category: normalizeCategory(item.category)
    }))
    .filter(item => item.query && item.reason)
    .slice(0, 6);
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

function extractOutputText(data) {
  if (typeof data?.output_text === "string") {
    return data.output_text.trim();
  }

  return (
    data?.output
      ?.flatMap(item => item.content || [])
      ?.map(content => content.text || "")
      ?.join("")
      ?.trim() || ""
  );
}

function buildFallbackResult(isCelebrity) {
  return {
    score: 68,
    detectedVibe: "Casual relaxed outfit",
    colors: ["white", "grey"],
    materials: ["cotton", "jersey"],
    styleTags: ["casual", "minimal", "relaxed"],
    keep: ["white fitted top"],
    swap: [
      {
        from: "grey sweatpants",
        to: "grey straight-leg tailored trousers",
        why: "The sweatpants make the look feel too lounge-based; tailored trousers keep the comfort but make it more styled."
      }
    ],
    add: [
      "narrow black sunglasses",
      "silver hoop earrings",
      "small black shoulder bag"
    ],
    avoid: ["mixing lounge bottoms with polished accessories"],
    styleDirections: [
      "Keep the fitted top and upgrade the base with cleaner bottoms.",
      "Use minimal accessories to make the outfit feel intentional without over-styling."
    ],
    shopFor: [
      {
        query: "women's grey straight leg tailored trousers",
        reason: "Creates a cleaner base while keeping the outfit relaxed.",
        category: "pants"
      },
      {
        query: "women's black pointed ankle boots block heel",
        reason: "Adds a sleek shoe that elevates the outfit.",
        category: "shoes"
      },
      {
        query: "women's narrow black sunglasses",
        reason: "Adds a polished model-off-duty accessory.",
        category: "accessories"
      },
      {
        query: "women's silver small hoop earrings",
        reason: "Adds subtle jewelry without cluttering the look.",
        category: "accessories"
      },
      {
        query: "women's black mini shoulder bag",
        reason: "Finishes the outfit with a clean practical accessory.",
        category: "accessories"
      }
    ],
    celebrityInspoQueries: isCelebrity
      ? [
          "celebrity model off duty white fitted top grey trousers",
          "celebrity narrow sunglasses casual chic outfit",
          "celebrity silver hoop earrings casual street style",
          "celebrity black shoulder bag model off duty outfit"
        ]
      : []
  };
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
      ? `Analyze the uploaded outfit and restyle it toward ${celebrityName || "the selected celebrity"}. Celebrity profile: ${celebrityProfile || "Use recognizable celebrity style references only when they create a wearable outfit."}`
      : `Analyze the uploaded outfit and style it toward ${targetStyle || "Casual Chic"}.`;

    const systemInstruction = `
Return JSON only. No markdown. No text outside JSON.

You are a professional fashion stylist with formal fashion knowledge.
You build wearable, cohesive, realistic outfits.

OUTPUT EXACT JSON:
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

STRICT STYLE RULES:
- Build ONE clear aesthetic.
- Do not mix incompatible aesthetics.
- Avoid sporty + elegant.
- Avoid gymwear + formal.
- Avoid lounge + luxury tailoring.
- Avoid athletic polyester + wool tailoring.
- If the base outfit is too casual, swap the base item first.
- Do not simply add fancy accessories on top of a weak base outfit.
- Fix the base outfit first, then add accessories.
- No body shaming.
- No attractiveness ratings.

SILHOUETTE RULES:
- Fitted top can work with relaxed or structured bottoms.
- Oversized top needs slimmer or structured bottoms.
- Cropped top with sweatpants is casual; for elevated looks, swap the bottoms.
- Avoid bulky-on-bulky unless intentionally streetwear.

COLOR RULES:
- Use 2 to 3 main colors.
- Prefer monochrome, tonal, neutral plus accent, or clean contrast.
- Accessories must connect to the palette.

ACCESSORY RULES:
- Always consider accessories.
- shopFor must include at least 2 accessories.
- At least one accessory must be jewelry or sunglasses.
- Good accessories include:
  narrow sunglasses, hoop earrings, layered necklaces, belts, shoulder bags, watches, scarves, claw clips, hair clips.
- Do not over-accessorize.
- Usually suggest 1 to 3 accessories.

CELEBRITY RULES:
- If mode is celebrity, adapt toward the celebrity while preserving only items that truly work.
- Do not preserve an item just because it exists.
- If an item blocks the celebrity style, swap it.

Bella Hadid / model-off-duty:
- fitted tops, tailored trousers, low-rise or straight-leg bottoms, narrow sunglasses, shoulder bags, pointed boots, loafers, simple jewelry.
- do NOT keep sweatpants and add leather jacket/boots as if that creates Bella Hadid style.

Hailey Bieber:
- clean basics, oversized blazer, straight jeans/trousers, loafers, clean sneakers, gold hoops, sleek shoulder bag.

Dove Cameron:
- dark romantic, corset shapes, mini skirts or tailored pants, black boots, silver jewelry, soft glam accessories.

Kendall Jenner:
- sleek minimal styling, fitted tops, straight trousers, pointed boots/heels, simple bags, clean lines.

Rihanna:
- bold but coherent styling, statement outerwear, strong accessories, luxury streetwear only when the base supports it.

Zendaya:
- polished editorial tailoring, strong silhouette, refined accessories.

OUTPUT LIMITS:
- colors max 4.
- materials max 4.
- styleTags max 4.
- keep max 3.
- swap max 1.
- add max 4.
- avoid max 2.
- styleDirections exactly 2.
- shopFor exactly 5 to 6 items.
- celebrityInspoQueries exactly 4 only if celebrity mode, otherwise [].
- Never keep and swap the same item.

SHOPPING RULES:
- shopFor must include 5 to 6 items.
- shopFor must include:
  1. one base clothing item if needed
  2. one shoe item
  3. one bag OR jewelry item
  4. one sunglasses OR jewelry item
  5. one optional finishing piece
- shopFor must ALWAYS include at least 2 accessories.
- At least one accessory must be jewelry or sunglasses.
- Queries must be specific and product-search friendly.
- Bad query: "pants"
- Good query: "women's grey straight leg tailored trousers"
- Bad query: "jewelry"
- Good query: "women's silver chunky hoop earrings"
- Bad query: "sunglasses"
- Good query: "women's narrow black rectangular sunglasses"
- Category must be exactly one of:
  "tops", "pants", "shoes", "outerwear", "accessories", "dresses", "other"
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

    if (result.styleDirections.length < 2) {
      result.styleDirections = [
        "Keep the strongest existing piece and improve the outfit base.",
        "Use accessories that match the same color palette and style direction."
      ];
    }

    if (result.shopFor.length < 5) {
      const fallback = buildFallbackResult(isCelebrity);
      result.shopFor = fallback.shopFor;
    }

    const accessoriesCount = result.shopFor.filter(
      item => item.category === "accessories"
    ).length;

    if (accessoriesCount < 2) {
      result.shopFor.push(
        {
          query: "women's narrow black rectangular sunglasses",
          reason: "Adds a polished styling accessory that works with many outfits.",
          category: "accessories"
        },
        {
          query: "women's silver small hoop earrings",
          reason: "Adds subtle jewelry without making the outfit feel overdone.",
          category: "accessories"
        }
      );
    }

    result.shopFor = result.shopFor.slice(0, 6);
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
