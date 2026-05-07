const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCategory(value) {
  const category = cleanText(value).toLowerCase();

  const allowed = new Set([
    "top",
    "bottom",
    "shoes",
    "accessory",
    "outerwear",
    "other"
  ]);

  return allowed.has(category) ? category : "other";
}

function normalizeTier(value) {
  const tier = cleanText(value);

  const allowed = new Set([
    "budget",
    "midRange",
    "premium"
  ]);

  return allowed.has(tier) ? tier : "midRange";
}

function normalizeQueries(body) {
  if (Array.isArray(body?.queries)) {
    return body.queries
      .map(q => {
        if (typeof q === "string") {
          return {
            searchQuery: q,
            category: "other",
            reason: "",
            tier: "midRange"
          };
        }

        return {
          searchQuery: cleanText(q.searchQuery || q.suggestedItem || q.query),
          category: normalizeCategory(q.category || "other"),
          reason: cleanText(q.reason || ""),
          tier: normalizeTier(q.tier || "midRange")
        };
      })
      .filter(q => q.searchQuery);
  }

  if (Array.isArray(body?.shopFor)) {
    return body.shopFor
      .map(item => {
        if (typeof item === "string") {
          return {
            searchQuery: item,
            category: "other",
            reason: "",
            tier: "midRange"
          };
        }

        return {
          searchQuery: cleanText(item.query),
          category: normalizeCategory(item.category || "other"),
          reason: cleanText(item.reason || ""),
          tier: normalizeTier(item.tier || "midRange")
        };
      })
      .filter(q => q.searchQuery);
  }

  return [];
}

function buildFashionQuery(query, tier = "midRange") {
  const base = `${cleanText(query)} women's fashion`;

  if (tier === "budget") {
    return `${base} H&M Zara Bershka Dynamite Amazon`;
  }

  if (tier === "midRange") {
    return `${base} Zara Mango Dynamite Steve Madden Aldo`;
  }

  if (tier === "premium") {
    return `${base} Reformation Aritzia COS Massimo Dutti`;
  }

  return base;
}

async function searchSerpApiShopping(queryInfo) {
  const apiKey = process.env.SERPAPI_KEY;

  if (!apiKey) {
    throw new Error("Missing SERPAPI_KEY in Vercel environment variables");
  }

  const url = new URL(SERPAPI_ENDPOINT);
  url.searchParams.set("engine", "google_shopping");
  url.searchParams.set("q", buildFashionQuery(queryInfo.searchQuery, queryInfo.tier));
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("gl", "ca");
  url.searchParams.set("hl", "en");
  url.searchParams.set("num", "20");

  const response = await fetch(url.toString());
  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(data.error || "SerpApi request failed");
  }

  return Array.isArray(data.shopping_results) ? data.shopping_results : [];
}

function normalizeProduct(item, queryInfo, index) {
  const title = cleanText(item.title);
  const imageURL = cleanText(item.thumbnail || item.serpapi_thumbnail || item.image);
  const purchaseURL = cleanText(item.link || item.product_link);
  const subtitle = cleanText(item.source || item.seller || item.merchant) || "Online store";
  const priceText = cleanText(item.price) || "Price unavailable";

  if (!title || !purchaseURL) return null;

  return {
    id: cleanText(item.product_id) || `${queryInfo.searchQuery}-${queryInfo.tier}-${index}`,
    title,
    subtitle,
    priceText,
    imageURL,
    purchaseURL,
    category: queryInfo.category || "other",
    sourceQuery: queryInfo.searchQuery,
    recommendationReason: queryInfo.reason || "Matches your styling suggestion.",
    tier: queryInfo.tier || "midRange"
  };
}

function dedupe(products) {
  const seen = new Set();

  return products.filter(p => {
    const key = p.purchaseURL.toLowerCase();

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function scoreProduct(product) {
  let score = 0;

  const title = `${product.title} ${product.subtitle}`.toLowerCase();

  const goodBrands = [
    "zara",
    "bershka",
    "mango",
    "dynamite",
    "aldo",
    "steve madden",
    "aritzia",
    "cos",
    "massimo dutti",
    "reformation",
    "h&m"
  ];

  const weakSources = [
    "amazon",
    "etsy",
    "ebay",
    "aliexpress",
    "temu"
  ];

  for (const brand of goodBrands) {
    if (title.includes(brand)) score += 4;
  }

  for (const source of weakSources) {
    if (title.includes(source)) score -= 2;
  }

  if (product.imageURL) score += 2;
  if (product.priceText && product.priceText !== "Price unavailable") score += 2;
  if (product.recommendationReason) score += 1;

  return score;
}

function sortProducts(products) {
  return products.sort((a, b) => scoreProduct(b) - scoreProduct(a));
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        products: [],
        error: "Method not allowed"
      });
    }

    const queries = normalizeQueries(req.body);

    if (queries.length === 0) {
      return res.status(200).json({
        products: [],
        debug: {
          message: "No product queries received",
          receivedBody: req.body
        }
      });
    }

    const allProducts = [];

    for (const queryInfo of queries.slice(0, 8)) {
      const results = await searchSerpApiShopping(queryInfo);

      results.slice(0, 6).forEach((item, index) => {
        const product = normalizeProduct(item, queryInfo, index);

        if (product) {
          allProducts.push(product);
        }
      });
    }

    const finalProducts = sortProducts(dedupe(allProducts)).slice(0, 32);

    return res.status(200).json({
      products: finalProducts,
      debug: {
        receivedQueries: queries.map(q => ({
          query: q.searchQuery,
          category: q.category,
          tier: q.tier
        })),
        productCount: allProducts.length,
        finalCount: finalProducts.length
      }
    });
  } catch (error) {
    return res.status(500).json({
      products: [],
      error: error.message || "Product search failed"
    });
  }
}
