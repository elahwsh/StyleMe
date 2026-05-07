const SERPER_ENDPOINT = "https://google.serper.dev/shopping";

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeQueries(body) {
  if (!Array.isArray(body?.shopFor)) return [];

  return body.shopFor
    .map(item => ({
      searchQuery: cleanText(item.query),
      category: cleanText(item.category || "other"),
      reason: cleanText(item.reason || ""),
      tier: cleanText(item.tier || "midRange")
    }))
    .filter(q => q.searchQuery);
}

function buildFashionQuery(query, tier = "midRange") {
  const base = `${query} women's fashion`;

  if (tier === "budget") {
    return `${base} H&M Zara Bershka`;
  }

  if (tier === "premium") {
    return `${base} Aritzia Reformation COS`;
  }

  return `${base} Zara Mango Dynamite`;
}

async function searchShopping(queryInfo) {
  const apiKey = process.env.SERPER_API_KEY;

  if (!apiKey) {
    throw new Error("Missing SERPER_API_KEY");
  }

  const response = await fetch(SERPER_ENDPOINT, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      q: buildFashionQuery(queryInfo.searchQuery, queryInfo.tier),
      gl: "ca",
      hl: "en"
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Shopping search failed");
  }

  return Array.isArray(data.shopping) ? data.shopping : [];
}

function normalizeProduct(item, queryInfo, index) {
  const title = cleanText(item.title);
  const imageURL = cleanText(item.imageUrl);
  const purchaseURL = cleanText(item.link);
  const subtitle = cleanText(item.source);
  const priceText = cleanText(item.price);

  if (!title || !purchaseURL) return null;

  return {
    id: `${queryInfo.searchQuery}-${index}`,
    title,
    subtitle,
    priceText,
    imageURL,
    purchaseURL,
    category: queryInfo.category,
    sourceQuery: queryInfo.searchQuery,
    recommendationReason: queryInfo.reason
  };
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

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        products: [],
        error: "Method not allowed"
      });
    }

    const queries = normalizeQueries(req.body);

    const allProducts = [];

    for (const queryInfo of queries.slice(0, 8)) {
      const results = await searchShopping(queryInfo);

      results.slice(0, 6).forEach((item, index) => {
        const product = normalizeProduct(item, queryInfo, index);

        if (product) {
          allProducts.push(product);
        }
      });
    }

    return res.status(200).json({
      products: dedupe(allProducts).slice(0, 32)
    });
  } catch (error) {
    return res.status(500).json({
      products: [],
      error: error.message || "Product search failed"
    });
  }
}
