const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeQueries(body) {
  if (Array.isArray(body?.queries)) {
    return body.queries
      .map(q => {
        if (typeof q === "string") {
          return {
            searchQuery: cleanText(q),
            category: "other",
            reason: "",
            tier: ""
          };
        }

        return {
          searchQuery: cleanText(q.searchQuery || q.suggestedItem || q.query),
          category: cleanText(q.category || "other"),
          reason: cleanText(q.reason || ""),
          tier: cleanText(q.tier || "")
        };
      })
      .filter(q => q.searchQuery);
  }

  if (Array.isArray(body?.shopFor)) {
    return body.shopFor
      .map(item => {
        if (typeof item === "string") {
          return {
            searchQuery: cleanText(item),
            category: "other",
            reason: "",
            tier: ""
          };
        }

        return {
          searchQuery: cleanText(item.query),
          category: cleanText(item.category || "other"),
          reason: cleanText(item.reason || ""),
          tier: cleanText(item.tier || "")
        };
      })
      .filter(q => q.searchQuery);
  }

  return [];
}

function buildFashionQuery(queryInfo) {
  const query = cleanText(queryInfo.searchQuery);
  const tier = cleanText(queryInfo.tier);

  let brandBoost = "";

  if (tier === "budget") {
    brandBoost = "H&M Bershka Pull&Bear Dynamite";
  } else if (tier === "midRange") {
    brandBoost = "Zara Mango Dynamite Aritzia Aldo Steve Madden";
  } else if (tier === "premium") {
    brandBoost = "COS Massimo Dutti Reformation Aritzia";
  } else {
    brandBoost = "Zara Mango H&M Bershka Dynamite Aritzia";
  }

  return `${query} ${brandBoost} women's fashion`;
}

async function searchShopping(queryInfo) {
  const apiKey = process.env.SERPAPI_KEY;

  if (!apiKey) {
    throw new Error("Missing SERPAPI_KEY in Vercel environment variables");
  }

  const url = new URL(SERPAPI_ENDPOINT);
  url.searchParams.set("engine", "google_shopping");
  url.searchParams.set("q", buildFashionQuery(queryInfo));
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("gl", "ca");
  url.searchParams.set("hl", "en");
  url.searchParams.set("num", "10");

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

  if (!title || !purchaseURL || !imageURL) return null;

  return {
    id: cleanText(item.product_id) || `${queryInfo.category}-${queryInfo.searchQuery}-${index}`,
    title,
    subtitle,
    priceText,
    imageURL,
    purchaseURL,
    category: normalizeCategory(queryInfo.category),
    sourceQuery: queryInfo.searchQuery,
    recommendationReason: queryInfo.reason || "Matches the outfit style."
  };
}

function normalizeCategory(category) {
  const allowed = new Set([
    "top",
    "bottom",
    "shoes",
    "accessory",
    "outerwear",
    "other"
  ]);

  const clean = cleanText(category);

  return allowed.has(clean) ? clean : "other";
}

function dedupe(products) {
  const seen = new Set();

  return products.filter(product => {
    const key = product.purchaseURL.toLowerCase();

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function scoreProduct(product, queryInfo) {
  const title = product.title.toLowerCase();
  const query = queryInfo.searchQuery.toLowerCase();

  let score = 0;

  const queryWords = query
    .split(/\s+/)
    .map(w => w.trim())
    .filter(Boolean);

  for (const word of queryWords) {
    if (word.length > 2 && title.includes(word)) {
      score += 2;
    }
  }

  const importantWords = [
    "denim",
    "corset",
    "strapless",
    "wide",
    "baggy",
    "low",
    "rise",
    "mini",
    "straight",
    "tailored",
    "blazer",
    "trench",
    "coat",
    "loafer",
    "platform",
    "shoulder",
    "bag",
    "sunglasses",
    "belt"
  ];

  for (const word of importantWords) {
    if (query.includes(word) && title.includes(word)) {
      score += 4;
    }
  }

  return score;
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

    const limitedQueries = queries.slice(0, 8);

    const searchTasks = limitedQueries.map(async queryInfo => {
      try {
        const results = await searchShopping(queryInfo);

        return results
          .slice(0, 5)
          .map((item, index) => normalizeProduct(item, queryInfo, index))
          .filter(Boolean)
          .map(product => ({
            ...product,
            _score: scoreProduct(product, queryInfo)
          }));
      } catch (error) {
        console.error("Product search failed for:", queryInfo.searchQuery, error.message);
        return [];
      }
    });

    const groupedResults = await Promise.all(searchTasks);

    const products = dedupe(groupedResults.flat())
      .sort((a, b) => b._score - a._score)
      .map(({ _score, ...product }) => product)
      .slice(0, 32);

    return res.status(200).json({
      products,
      debug: {
        receivedQueries: queries.map(q => q.searchQuery),
        searchedQueries: limitedQueries.map(q => q.searchQuery),
        productCount: products.length
      }
    });
  } catch (error) {
    return res.status(500).json({
      products: [],
      error: error.message || "Product search failed"
    });
  }
}
