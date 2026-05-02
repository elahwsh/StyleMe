const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeShopFor(shopFor) {
  if (!Array.isArray(shopFor)) return [];

  return shopFor
    .map(item => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item.query === "string") return item.query.trim();
      return "";
    })
    .filter(Boolean)
    .slice(0, 3);
}

function inferCategory(text) {
  const value = cleanText(text).toLowerCase();

  if (/(pants|trouser|jeans|leggings|joggers|sweatpants|shorts|skirt)/.test(value)) {
    return "pants";
  }

  if (/(top|shirt|blouse|tank|tee|t-shirt|corset|bodysuit|sweater|cardigan|hoodie)/.test(value)) {
    return "tops";
  }

  if (/(shoe|boot|boots|heel|heels|sneaker|sneakers|loafer|loafers|flat|flats|sandal|sandals)/.test(value)) {
    return "shoes";
  }

  if (/(jacket|coat|blazer|trench|outerwear|leather jacket|puffer|vest)/.test(value)) {
    return "outerwear";
  }

  if (/(bag|purse|necklace|earring|earrings|bracelet|belt|sunglasses|glasses|scarf|hat|cap)/.test(value)) {
    return "accessories";
  }

  if (/(dress|gown)/.test(value)) {
    return "dresses";
  }

  return "other";
}

function buildFashionQuery(query) {
  const cleaned = cleanText(query);
  if (!cleaned) return "";

  const category = inferCategory(cleaned);

  if (category === "pants") return `${cleaned} women's fashion`;
  if (category === "tops") return `${cleaned} women's fashion`;
  if (category === "shoes") return `${cleaned} women's fashion`;
  if (category === "outerwear") return `${cleaned} women's fashion`;
  if (category === "accessories") return `${cleaned} women's accessories`;
  if (category === "dresses") return `${cleaned} women's fashion`;

  return `${cleaned} women's fashion clothing`;
}

async function searchSerpApiShopping(query) {
  const apiKey = process.env.SERPAPI_KEY;

  if (!apiKey) {
    throw new Error("Missing SERPAPI_KEY");
  }

  const url = new URL(SERPAPI_ENDPOINT);

  url.searchParams.set("engine", "google_shopping");
  url.searchParams.set("q", buildFashionQuery(query));
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("google_domain", "google.com");
  url.searchParams.set("gl", "us");
  url.searchParams.set("hl", "en");
  url.searchParams.set("num", "14");

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
    "cat"
  ];

  if (blockedWords.some(word => title.includes(word))) return true;
  if (blockedWords.some(word => source.includes(word))) return true;

  return false;
}

function normalizeProduct(item, sourceQuery) {
  const title = cleanText(item.title);
  const imageURL = cleanText(item.thumbnail) || cleanText(item.serpapi_thumbnail);
  const purchaseURL = cleanText(item.link) || cleanText(item.product_link);
  const source = cleanText(item.source);
  const price = cleanText(item.price);
  const category = inferCategory(`${sourceQuery} ${title}`);

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
    sourceQuery,
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

    const queries = Array.isArray(req.body?.queries)
  ? req.body.queries.map(q => q.searchQuery || q.suggestedItem || "").filter(Boolean)
  : normalizeShopFor(req.body?.shopFor);

    if (queries.length === 0) {
      return res.status(400).json({
        error: "Missing shopFor array"
      });
    }

    const allProducts = [];

    for (const query of queries) {
      const results = await searchSerpApiShopping(query);

      for (const item of results) {
        if (isBadProduct(item)) continue;

        const product = normalizeProduct(item, query);

        if (product) {
          allProducts.push(product);
        }
      }
    }

    const products = dedupeProducts(allProducts).slice(0, 18);

    return res.status(200).json({
      products
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Product search failed"
    });
  }
}
