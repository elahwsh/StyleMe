function normalizeScore(score) {
  if (score == null || Number.isNaN(Number(score))) return 0;
  const numeric = Math.round(Number(score));
  if (numeric > 0 && numeric <= 10) return Math.min(100, numeric * 10);
  return Math.max(0, Math.min(100, numeric));
}

function safeArray(value, max = 4) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

// 🔥 NEW: extract concrete clothing tags for matching
function extractTags(result) {
  const tags = [];

  // prioritize actual changes
  result.swap?.forEach(s => {
    if (s.to) tags.push(s.to);
  });

  result.add?.forEach(a => tags.push(a));

  // fallback to kept items if needed
  if (tags.length < 3) {
    result.keep?.forEach(k => tags.push(k));
  }

  return tags
    .map(t => t.toLowerCase().trim())
    .filter(Boolean)
    .slice(0, 5);
}

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

    const isCelebrity = mode === "celebrity";

    const userText = isCelebrity
      ? `Analyze the uploaded outfit and restyle it toward ${celebrityName}. Celebrity profile: ${celebrityProfile}. Prioritize the smallest changes possible. Keep items that already work. Only swap items that clearly need changing.`
      : `Analyze the uploaded outfit and style it toward ${targetStyle}. Prioritize the smallest changes possible. Keep items that already work. Only swap items that clearly need changing.`;

PROFESSIONAL STYLIST OUTPUT RULES:
- Think like a real stylist building a complete look, not a basic checklist.
- Always consider:
  1. silhouette
  2. proportion
  3. color palette
  4. texture/material
  5. shoe choice
  6. bag choice
  7. jewelry/accessories
  8. occasion
  9. target celebrity/style reference

- If the current outfit is too casual for the target style, do not simply add fancy items on top.
- First fix the base outfit, then add accessories.
- A good look must include a coherent base + shoes + accessory direction.
- Do not suggest random accessories; accessories must support the outfit vibe.

SHOPPING RULES:
- shopFor must include exactly 5 items.
- shopFor must include at least:
  1. one clothing base item if needed
  2. one shoe item
  3. one bag OR jewelry item
  4. one styling accessory
  5. one optional finishing piece

- Each shopFor query must be specific enough for product search.
- Bad query: "pants"
- Good query: "women's low rise wide leg tailored trousers brown"
- Bad query: "jewelry"
- Good query: "women's silver chunky hoop earrings"
- Bad query: "shoes"
- Good query: "women's pointed black ankle boots block heel"

ACCESSORY RULES:
- Always suggest accessories if they improve the look.
- Accessories can include:
  - belts
  - sunglasses
  - hoop earrings
  - layered necklaces
  - shoulder bags
  - claw clips
  - hair accessories
  - watches
  - scarves
- Avoid over-accessorizing. Usually 1–3 accessories is enough.

CELEBRITY STYLE RULES:
- For Bella Hadid / model-off-duty:
  - prioritize clean proportions, fitted tops, tailored bottoms, narrow sunglasses, shoulder bags, pointed boots, loafers, leather jackets, simple jewelry.
  - do NOT pair sweatpants with leather jacket unless the target is sporty streetwear.
- For Hailey Bieber:
  - prioritize minimal basics, oversized blazer, clean sneakers/loafers, gold hoops, sleek bun, shoulder bag.
- For Dove Cameron:
  - prioritize dark romantic, corset/bustier shapes, mini skirt or tailored pants, black boots, silver jewelry, soft glam accessories.

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
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
        error: "Invalid JSON from model",
        raw: outputText
      });
    }

    const keep = safeArray(parsed.keep, 3);

    let swap = Array.isArray(parsed.swap)
      ? parsed.swap
          .filter(item =>
            item &&
            typeof item.from === "string" &&
            typeof item.to === "string" &&
            typeof item.why === "string"
          )
          .slice(0, 1)
      : [];

    // 🔥 prevent keep/swap conflict
    swap = swap.filter(item => {
      const from = item.from.toLowerCase();
      return !keep.some(k => {
        const kept = k.toLowerCase();
        return kept.includes(from) || from.includes(kept);
      });
    });

    const result = {
      score: normalizeScore(parsed.score),
      detectedVibe: typeof parsed.detectedVibe === "string" ? parsed.detectedVibe : "",
      colors: safeArray(parsed.colors, 4),
      materials: safeArray(parsed.materials, 4),
      styleTags: safeArray(parsed.styleTags, 4),
      keep,
      swap,
      add: safeArray(parsed.add, 3),
      avoid: safeArray(parsed.avoid, 2),
      styleDirections: safeArray(parsed.styleDirections, 2),
      shopFor: Array.isArray(parsed.shopFor)
        ? parsed.shopFor
            .filter(item =>
              item &&
              typeof item.query === "string" &&
              typeof item.reason === "string"
            )
            .slice(0, 3)
        : [],
      celebrityInspoQueries: isCelebrity
        ? safeArray(parsed.celebrityInspoQueries, 4)
        : []
    };

    // ✅ NEW: attach tags for curated library matching
    result.tagsToMatch = extractTags(result);

    return res.status(200).json(result);

  } catch (error) {
    return res.status(500).json({
      error:
        error?.name === "AbortError"
          ? "OpenAI request timed out"
          : error?.message || "Server error"
    });
  }
}
