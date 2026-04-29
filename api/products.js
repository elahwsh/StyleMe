function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePrice(price) {
  if (!price || !price.value || !price.currency) {
    return "Price unavailable";
  }

  return `${price.currency} ${price.value}`;
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

async function getEbayAccessToken() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET");
  }

  const encodedCredentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${encodedCredentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope"
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error_description ||
      data.error ||
      "Failed to authenticate with eBay"
    );
  }

  return data.access_token;
}

async function searchEbayProducts(query, accessToken) {
  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");

  url.searchParams.set("q", query);
  url.searchParams.set("limit", "8");
  url.searchParams.set("category_ids", "11450");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US"
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.errors?.[0]?.message ||
      data.error_description ||
      "eBay product search failed"
    );
  }

  return Array.isArray(data.itemSummaries) ? data.itemSummaries : [];
}

function mapEbayItem(item, sourceQuery) {
  const id = cleanText(item.itemId);
  const title = cleanText(item.title);
  const imageURL = cleanText(item.image?.imageUrl);
  const purchaseURL = cleanText(item.itemWebUrl);

  if (!id || !title || !imageURL || !purchaseURL) {
    return null;
  }

  const sellerName = cleanText(item.seller?.username);
  const condition = cleanText(item.condition);

  const subtitleParts = [];

  if (sellerName) subtitleParts.push(sellerName);
  if (condition) subtitleParts.push(condition);

  return {
    id,
    title,
    subtitle: subtitleParts.length ? subtitleParts.join(" • ") : "Available online",
    imageURL,
    priceText: normalizePrice(item.price),
    purchaseURL,
    sourceQuery
  };
}

function dedupeProducts(products) {
  const seen = new Set();
  const unique = [];

  for (const product of products) {
    if (!product || !product.id) continue;
    if (seen.has(product.id)) continue;

    seen.add(product.id);
    unique.push(product);
  }

  return unique;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const queries = normalizeShopFor(req.body?.shopFor);

    if (queries.length === 0) {
      return res.status(400).json({
        error: "Missing shopFor array"
      });
    }

    const accessToken = await getEbayAccessToken();

    const products = [];

    for (const query of queries) {
      const items = await searchEbayProducts(query, accessToken);

      for (const item of items) {
        const mapped = mapEbayItem(item, query);
        if (mapped) products.push(mapped);
      }
    }

    const uniqueProducts = dedupeProducts(products).slice(0, 12);

    return res.status(200).json({
      products: uniqueProducts
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Product search failed"
    });
  }
}
