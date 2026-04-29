const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeShopFor(shopFor) {
  if (!Array.isArray(shopFor)) return [];

  return shopFor
    .map(item => {
      if (typeof item === "string") return item.trim();

      if (item && typeof item.query === "string") {
        return item.query.trim();
      }

      return "";
    })
    .filter(Boolean)
    .slice(0, 3);
}

function buildFashionQuery(query) {
  const cleaned = cleanText(query);

  if (!cleaned) return "";

  const lower = cleaned.toLowerCase();

  const fashionWords = [
    "top",
    "shirt",
    "blouse",
    "pants",
    "jeans",
    "skirt",
    "dress",
    "jacket",
    "coat",
    "cardigan",
    "sweater",
    "boots",
    "heels",
    "sneakers",
    "loafers",
    "bag",
    "necklace",
    "earrings",
    "belt"
  ];

  const alreadyFashion = fashionWords.some(word => lower.includes(word));

  return alreadyFashion ? cleaned : `${cleaned} fashion clothing`;
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
  url.searchParams.set("num", "12");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Accept": "application/json"
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error ||
      data.search_metadata?.status ||
      "SerpApi request failed"
    );
  }

  if (data.error) {
    throw new Error(data.error);
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
    "girls",
    "doll",
    "pattern",
    "sewing",
    "fabric",
    "template",
    "wallpaper",
    "poster"
  ];

  if (blockedWords.some(word => title.includes(word))) return true;
  if (blockedWords.some(word => source.includes(word))) return true;

  return false;
}

function normalizeProduct(item, sourceQuery) {
  const title = cleanText(item.title);
  const imageURL =
    cleanText(item.thumbnail) ||
    cleanText(item.serpapi_thumbnail);

  const purchaseURL =
    cleanText(item.link) ||
    cleanText(item.product_link);

  const source = cleanText(item.source);
  const price = cleanText(item.price);

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
    sourceQuery
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

    const queries = normalizeShopFor(req.body?.shopFor);

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
