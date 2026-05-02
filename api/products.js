const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeQueries(body) {
  if (Array.isArray(body?.queries)) {
    return body.queries
      .map(q => {
        if (typeof q === "string") return { searchQuery: q, category: "other", reason: "" };

        return {
          searchQuery: cleanText(q.searchQuery || q.suggestedItem || q.query),
          category: cleanText(q.category || "other"),
          reason: cleanText(q.reason || "")
        };
      })
      .filter(q => q.searchQuery);
  }

  if (Array.isArray(body?.shopFor)) {
    return body.shopFor
      .map(item => {
        if (typeof item === "string") {
          return { searchQuery: item, category: "other", reason: "" };
        }

        return {
          searchQuery: cleanText(item.query),
          category: cleanText(item.category || "other"),
          reason: cleanText(item.reason || "")
        };
      })
      .filter(q => q.searchQuery);
  }

  return [];
}

function buildFashionQuery(query) {
  return `${cleanText(query)} women's fashion`;
}

async function searchSerpApiShopping(query) {
  const apiKey = process.env.SERPAPI_KEY;

  if (!apiKey) {
    throw new Error("Missing SERPAPI_KEY in Vercel environment variables");
  }

  const url = new URL(SERPAPI_ENDPOINT);
  url.searchParams.set("engine", "google_shopping");
  url.searchParams.set("q", buildFashionQuery(query));
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
    id: cleanText(item.product_id) || `${queryInfo.searchQuery}-${index}`,
    title,
    subtitle,
    priceText,
    imageURL,
    purchaseURL,
    category: queryInfo.category || "other",
    sourceQuery: queryInfo.searchQuery,
    recommendationReason: queryInfo.reason || "Matches your styling suggestion."
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

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ products: [], error: "Method not allowed" });
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
      const results = await searchSerpApiShopping(queryInfo.searchQuery);

      results.slice(0, 6).forEach((item, index) => {
        const product = normalizeProduct(item, queryInfo, index);
        if (product) allProducts.push(product);
      });
    }

    return res.status(200).json({
      products: dedupe(allProducts).slice(0, 24),
      debug: {
        receivedQueries: queries.map(q => q.searchQuery),
        productCount: allProducts.length
      }
    });
  } catch (error) {
    return res.status(500).json({
      products: [],
      error: error.message || "Product search failed"
    });
  }
}
