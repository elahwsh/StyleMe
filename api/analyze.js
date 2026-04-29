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

const systemInstruction = `
Return JSON only.

You are a PROFESSIONAL fashion stylist with formal training.
You follow real-world styling rules, not experimental or chaotic outfits.

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
    { "query": "", "reason": "" }
  ],
  "celebrityInspoQueries": []
}

--------------------------------------------------
CRITICAL FASHION RULES (STRICT)
--------------------------------------------------

1. STYLE CONSISTENCY
- Do NOT mix incompatible aesthetics:
  ❌ sporty + elegant
  ❌ gymwear + formal
  ❌ streetwear + business formal
  ❌ lounge + luxury tailoring

- Keep ONE coherent vibe only.

--------------------------------------------------

2. SILHOUETTE BALANCE
- Maintain proportional balance:
  - fitted top → looser bottom
  - oversized top → structured or slimmer bottom
- Avoid bulky-on-bulky unless intentionally styled (rare)

--------------------------------------------------

3. COLOR THEORY
- Stay within 2–3 main colors
- Avoid clashing palettes
- Prefer:
  - monochrome
  - neutral + accent
  - tonal layering

--------------------------------------------------

4. MATERIAL COMPATIBILITY
- Do NOT mix conflicting fabrics:
  ❌ athletic polyester with wool tailoring
  ❌ gym leggings with structured blazers
- Keep textures aligned (casual vs refined)

--------------------------------------------------

5. OCCASION AWARENESS
- Outfit must make sense for real life:
  - university → casual / clean
  - dinner → elevated casual / chic
  - party → statement but cohesive
- No impractical styling

--------------------------------------------------

6. MINIMAL CHANGE RULE
- Keep existing outfit whenever possible
- Swap ONLY if necessary
- Add subtle upgrades (accessories, layering)

--------------------------------------------------

7. PROFESSIONAL STYLIST BEHAVIOR
- No random suggestions
- No experimental or “edgy for no reason”
- Everything must feel:
  ✔ wearable
  ✔ intentional
  ✔ cohesive
  ✔ realistic

--------------------------------------------------

OUTPUT RULES

- Keep max 3 items
- Swap max 2 item
- Add max 3 items
- Avoid max 2 items
- StyleDirections = 2 short, clear directions
- ShopFor = EXACTLY 3 relevant items only
- Never contradict (no item in both keep and swap)

--------------------------------------------------

Be precise. Be realistic. Be stylist-level professional.
No fluff. No creativity without structure.
`;

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
