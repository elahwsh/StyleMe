function normalizeScore(score) {
  if (score == null || Number.isNaN(Number(score))) return 0;
  const numeric = Math.round(Number(score));
  if (numeric > 0 && numeric <= 10) return Math.min(100, numeric * 10);
  return Math.max(0, Math.min(100, numeric));
}

function safeArray(value, max = 4) {
  return Array.isArray(value) ? value.slice(0, max) : [];
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
      ? `Analyze the outfit and restyle it toward ${celebrityName}. Celebrity profile: ${celebrityProfile}. Prioritize the smallest changes possible. Keep items that already work. Only swap items that clearly need changing. Create image search queries that match the exact swap/add suggestions.`
      : `Analyze the outfit and style it toward ${targetStyle}. Prioritize the smallest changes possible. Keep items that already work. Only swap items that clearly need changing.`;

    const systemInstruction = `
Return JSON only.

You are a premium fashion stylist inside a fashion app.

Output EXACT JSON format:

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

CRITICAL LOGIC RULES:
- Prefer minimal changes.
- Do NOT suggest changing everything.
- Keep at least 1 existing item if it reasonably fits the target style.
- Never put the same clothing item in both "keep" and "swap".
- If an item is in keep, do not mention switching it.
- If an item is in swap, do not list it in keep.
- Swap max 1 item unless absolutely necessary.
- Add should be accessories/layers/shoes that improve the outfit without replacing the whole outfit.
- Avoid should be general styling mistakes, not items already worn unless they truly clash.
- StyleDirections must explain how to style the existing outfit with minimal changes.
- ShopFor must match the add/swap suggestions exactly.

CELEBRITY MODE RULES:
- If mode is celebrity, make suggestions that move the outfit toward the celebrity while preserving most of the user’s outfit.
- celebrityInspoQueries must match the exact recommended look.
- If the suggestion says "oversized blazer", the query must search for the celebrity wearing an oversized blazer.
- If the suggestion says "crop top", the query must search for the celebrity wearing a crop top.
- Do not search random celebrity outfits.
- Do not suggest "crop top" then search/show "coat" or unrelated outfit.
- celebrityInspoQueries exactly 4 search queries.
- Each query must include the celebrity name.
- Each query should include exact clothing terms from swap/add/styleDirections.
- Example: "Rihanna oversized blazer denim jeans street style"
- Example: "Rihanna crop top wide leg jeans outfit"
- Example: "Rihanna statement accessories denim outfit"
- Example: "Rihanna luxury streetwear jeans crop top"

STYLE RULES:
- Be specific.
- Be practical.
- Be concise.
- Score must be 0 to 100.
- Keep max 3 items.
- Swap max 1 item.
- Add max 3 items.
- Avoid max 2 items.
- StyleDirections exactly 2 short directions.
- ShopFor exactly 3 short shopping queries.
- Do not mention body type, torso, proportions, skin tone, or attractiveness.
- No markdown.
- No explanations outside JSON.
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

    // Extra safety: remove swaps that duplicate keep items
    swap = swap.filter(item => {
      const from = item.from.toLowerCase();
      return !keep.some(k => {
        const kept = k.toLowerCase();
        return kept.includes(from) || from.includes(kept);
      });
    });

    return res.status(200).json({
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
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.name === "AbortError" ? "OpenAI request timed out" : (error?.message || "Server error")
    });
  }
}
