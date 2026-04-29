api/analyze.js

function normalizeScore(score) {
  if (score == null || Number.isNaN(Number(score))) return 0;
  const numeric = Math.round(Number(score));
  if (numeric > 0 && numeric <= 10) return Math.min(100, numeric * 10);
  return Math.max(0, Math.min(100, numeric));
}
function safeArray(value, max = 4) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}
function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
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
  return [...new Set(
    tags
      .map(tag => tag.toLowerCase().trim())
      .filter(Boolean)
  )].slice(0, 8);
}
function cleanKeepSwapConflicts(keep, swap) {
  return swap.filter(item => {
    const from = item.from.toLowerCase();
    return !keep.some(k => {
      const kept = k.toLowerCase();
      return kept.includes(from) || from.includes(kept);
    });
  });
}
function normalizeShopFor(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item =>
      item &&
      typeof item.query === "string" &&
      typeof item.reason === "string"
    )
    .map(item => ({
      query: normalizeText(item.query),
      reason: normalizeText(item.reason),
      category: normalizeText(item.category || "other").toLowerCase()
    }))
    .filter(item => item.query && item.reason)
    .slice(0, 6);
}
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }
    const {
      mode,
      targetStyle,
      celebrityName,
      celebrityProfile,
      imageBase64
    } = req.body;
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }
    if (!imageBase64) {
      return res.status(400).json({ error: "Missing imageBase64" });
    }
    const isCelebrity = mode === "celebrity";
    const userText = isCelebrity
      ? `Analyze the uploaded outfit and restyle it toward ${celebrityName}. Celebrity profile: ${celebrityProfile}. Act like a professional stylist. Build a coherent complete look with fashion common sense.`
      : `Analyze the uploaded outfit and style it toward ${targetStyle}. Act like a professional stylist. Build a coherent complete look with fashion common sense.`;
    const systemInstruction = `
Return JSON only.
You are a PROFESSIONAL fashion stylist with formal fashion knowledge.
You are not a random outfit generator.
You must build wearable, cohesive, realistic looks.
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
    { "query": "", "reason": "", "category": "" }
  ],
  "celebrityInspoQueries": []
}
CRITICAL STYLIST LOGIC:
- Think like a real stylist creating a complete look.
- Do not make basic suggestions.
- Every suggestion must support ONE clear aesthetic.
- Never mix incompatible aesthetics.
- Do NOT pair sporty lounge pieces with classy, glam, tailored, luxury, or editorial pieces.
- Do NOT suggest leather jackets, heels, tailored coats, corsets, or luxury accessories with sweatpants unless the target style is explicitly sporty streetwear.
- If the current outfit is too casual for the target style, swap the casual base item first.
- Do not simply add fancy items on top of a weak base outfit.
- First fix the base outfit, then add finishing accessories.
- Suggestions must feel wearable, intentional, and realistic.
STYLE CONSISTENCY RULES:
- Avoid sporty + classy.
- Avoid gymwear + formal.
- Avoid lounge + luxury tailoring.
- Avoid athletic polyester + wool tailoring.
- Avoid casual sneakers with glam/elegant looks unless the target is intentionally casual.
- A look should have one main vibe only.
SILHOUETTE RULES:
- Fitted top can work with relaxed or tailored bottoms.
- Oversized top needs slimmer or structured bottoms.
- Cropped top with low-rise sweatpants is very casual; for elevated celebrity styling, swap bottoms.
- Wide-leg tailored pants, straight trousers, mini skirts, structured denim, or sleek boots can elevate a simple top.
- Avoid bulky-on-bulky unless intentionally streetwear.
COLOR RULES:
- Keep the look within 2–3 main colors.
- Prefer monochrome, tonal, neutral + accent, or clean contrast.
- Avoid random color additions.
- Accessories should connect to the palette.
ACCESSORY RULES:
- Always consider accessories.
- Accessories must support the outfit, not clutter it.
- Good accessories include:
  - narrow sunglasses
  - shoulder bags
  - hoop earrings
  - layered necklaces
  - belts
  - watches
  - hair clips
  - scarves
  - sleek handbags
- Usually suggest 1–3 accessories max.
CELEBRITY MODE RULES:
- If mode is celebrity, adapt the outfit toward the celebrity while preserving only items that truly work.
- Do not preserve an item just because it exists.
- If an item blocks the celebrity style, swap it.
- For Bella Hadid / model-off-duty:
  - prioritize fitted tops, tailored trousers, low-rise or straight-leg bottoms, narrow sunglasses, shoulder bags, pointed boots, loafers, leather jackets only with appropriate bottoms, simple jewelry.
  - do NOT keep sweatpants and add leather jacket/boots as if that creates Bella Hadid style.
- For Hailey Bieber:
  - prioritize clean basics, oversized blazer, straight jeans/trousers, loafers, clean sneakers, gold hoops, sleek shoulder bag.
- For Dove Cameron:
  - prioritize dark romantic, corset shapes, mini skirts or tailored pants, black boots, silver jewelry, soft glam accessories.
- For Kendall Jenner:
  - prioritize sleek minimal styling, fitted tops, straight trousers, pointed boots/heels, simple bags, clean lines.
- For Rihanna:
  - prioritize bold but coherent styling, statement outerwear, strong accessories, luxury streetwear only when the base supports it.
- For Zendaya:
  - prioritize polished, editorial, sleek tailoring, strong silhouette, refined accessories.
KEEP / SWAP RULES:
- Keep max 3 items.
- Swap max 1 item unless absolutely necessary.
- Never keep and swap the same item.
- If sweatpants, gym leggings, athletic shorts, or very casual sneakers clash with target style, they should be swapped, not styled around.
- Add should be accessories, shoes, bag, outerwear, or finishing pieces that complete the outfit.
- Avoid should name styling mistakes, not insult the user.
SHOPPING RULES:
- shopFor must include 5 to 6 items.
- shopFor must include:
  1. one base clothing item if needed
  2. one shoe item
  3. one bag OR jewelry item
  4. one styling accessory
  5. one optional finishing piece
- Each shopFor query must be specific and product-search friendly.
- Bad query: "pants"
- Good query: "women's brown low rise wide leg tailored trousers"
- Bad query: "jewelry"
- Good query: "women's silver chunky hoop earrings"
- Bad query: "shoes"
- Good query: "women's pointed black ankle boots block heel"
- Each shopFor item must include category exactly one of:
  "tops", "pants", "shoes", "outerwear", "accessories", "dresses", "other"
OUTPUT LIMITS:
- colors max 4.
- materials max 4.
- styleTags max 4.
- keep max 3.
- swap max 1.
- add max 4.
- avoid max 2.
- styleDirections exactly 2 short professional directions.
- shopFor 5 to 6 items.
- celebrityInspoQueries exactly 4 only if celebrity mode.
TONE:
- Be specific.
- Be practical.
- Be professional.
- No body shaming.
- No attractiveness ratings.
- No markdown.
- No explanations outside JSON.
`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
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
    swap = cleanKeepSwapConflicts(keep, swap);
    const result = {
      score: normalizeScore(parsed.score),
      detectedVibe: normalizeText(parsed.detectedVibe),
      colors: safeArray(parsed.colors, 4),
      materials: safeArray(parsed.materials, 4),
      styleTags: safeArray(parsed.styleTags, 4),
      keep,
      swap,
      add: safeArray(parsed.add, 4),
      avoid: safeArray(parsed.avoid, 2),
      styleDirections: safeArray(parsed.styleDirections, 2),
      shopFor: normalizeShopFor(parsed.shopFor),
      celebrityInspoQueries: isCelebrity
        ? safeArray(parsed.celebrityInspoQueries, 4)
        : []
    };
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

ShopForItem.swift

import Foundation
struct ShopForItem: Codable, Hashable {
    let query: String
    let reason: String
    let category: ProductCategory?
    enum CodingKeys: String, CodingKey {
        case query
        case reason
        case category
    }
}

api/products.js

const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";
function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}
function normalizeShopFor(shopFor) {
  if (!Array.isArray(shopFor)) return [];
  return shopFor
    .map(item => {
      if (typeof item === "string") {
        return {
          query: item.trim(),
          category: inferCategory(item)
        };
      }
      if (item && typeof item.query === "string") {
        return {
          query: item.query.trim(),
          category: cleanText(item.category || inferCategory(item.query)).toLowerCase()
        };
      }
      return null;
    })
    .filter(item => item && item.query)
    .slice(0, 6);
}
function inferCategory(text) {
  const value = cleanText(text).toLowerCase();
  if (/(pants|trouser|trousers|jeans|leggings|joggers|sweatpants|shorts|skirt|skorts)/.test(value)) {
    return "pants";
  }
  if (/(top|shirt|blouse|tank|tee|t-shirt|corset|bodysuit|sweater|cardigan|hoodie|vest)/.test(value)) {
    return "tops";
  }
  if (/(shoe|boot|boots|heel|heels|sneaker|sneakers|loafer|loafers|flat|flats|sandal|sandals|pump|pumps|mule|mules)/.test(value)) {
    return "shoes";
  }
  if (/(jacket|coat|blazer|trench|outerwear|leather jacket|puffer)/.test(value)) {
    return "outerwear";
  }
  if (/(bag|purse|handbag|shoulder bag|tote|clutch|necklace|earring|earrings|bracelet|belt|sunglasses|glasses|scarf|hat|cap|watch|clip)/.test(value)) {
    return "accessories";
  }
  if (/(dress|gown)/.test(value)) {
    return "dresses";
  }
  return "other";
}
function buildFashionQuery(query, category) {
  const cleaned = cleanText(query);
  if (!cleaned) return "";
  if (category === "accessories") return `${cleaned} women's fashion accessory`;
  if (category === "shoes") return `${cleaned} women's shoes`;
  if (category === "outerwear") return `${cleaned} women's outerwear`;
  if (category === "pants") return `${cleaned} women's fashion`;
  if (category === "tops") return `${cleaned} women's fashion`;
  if (category === "dresses") return `${cleaned} women's dress`;
  return `${cleaned} women's fashion`;
}
async function searchSerpApiShopping(shopIntent) {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    throw new Error("Missing SERPAPI_KEY");
  }
  const url = new URL(SERPAPI_ENDPOINT);
  url.searchParams.set("engine", "google_shopping");
  url.searchParams.set("q", buildFashionQuery(shopIntent.query, shopIntent.category));
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("google_domain", "google.com");
  url.searchParams.set("gl", "us");
  url.searchParams.set("hl", "en");
  url.searchParams.set("num", "10");
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error || "SerpApi request failed");
  }
  return Array.isArray(data.shopping_results) ? data.shopping_results : [];
}
function isBadProduct(item) {
  const title = cleanText(item.title).toLowerCase();
  const source = cleanText(item.source).toLowerCase();
  if (!title) return true;
  const blockedWords = [
    "costume",
    "halloween",
    "cosplay",
    "kids",
    "toddler",
    "baby",
    "men's",
    "mens",
    "boy",
    "boys",
    "girl",
    "girls",
    "doll",
    "pattern",
    "sewing",
    "fabric",
    "template",
    "wallpaper",
    "poster",
    "pet",
    "dog",
    "cat",
    "toy"
  ];
  if (blockedWords.some(word => title.includes(word))) return true;
  if (blockedWords.some(word => source.includes(word))) return true;
  return false;
}
function normalizeProduct(item, shopIntent) {
  const title = cleanText(item.title);
  const imageURL = cleanText(item.thumbnail) || cleanText(item.serpapi_thumbnail);
  const purchaseURL = cleanText(item.link) || cleanText(item.product_link);
  const source = cleanText(item.source);
  const price = cleanText(item.price);
  const category =
    cleanText(shopIntent.category) ||
    inferCategory(`${shopIntent.query} ${title}`);
  if (!title || !imageURL || !purchaseURL) {
    return null;
  }
  return {
    id:
      cleanText(item.product_id) ||
      Buffer.from(`${title}|${purchaseURL}`).toString("base64"),
    title,
    subtitle: source || "Online store",
    imageURL,
    priceText: price || "Price unavailable",
    purchaseURL,
    sourceQuery: shopIntent.query,
    category
  };
}
function dedupeProducts(products) {
  const seen = new Set();
  const unique = [];
  for (const product of products) {
    const key = `${product.title.toLowerCase()}|${product.purchaseURL.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(product);
  }
  return unique;
}
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        error: "Method not allowed"
      });
    }
    const shopIntents = normalizeShopFor(req.body?.shopFor);
    if (shopIntents.length === 0) {
      return res.status(400).json({
        error: "Missing shopFor array"
      });
    }
    const allProducts = [];
    for (const shopIntent of shopIntents) {
      const results = await searchSerpApiShopping(shopIntent);
      for (const item of results) {
        if (isBadProduct(item)) continue;
        const product = normalizeProduct(item, shopIntent);
        if (product) {
          allProducts.push(product);
        }
      }
    }
    const products = dedupeProducts(allProducts).slice(0, 24);
    return res.status(200).json({
      products
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Product search failed"
    });
  }
}
