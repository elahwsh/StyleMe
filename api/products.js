let ebayTokenCache = {
  accessToken: null,
  expiresAt: 0
};

function sanitizeText(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

async function getEbayAccessToken() {
  const now = Date.now();

  if (ebayTokenCache.accessToken && now < ebayTokenCache.expiresAt) {
    return ebayTokenCache.accessToken;
  }

  const basic = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope"
  });

  const data = await res.json();

  if (!data.access_token) {
    throw new Error("Failed to get eBay token");
  }

  ebayTokenCache = {
    accessToken: data.access_token,
    expiresAt: now + 7000 * 1000
  };

  return data.access_token;
}

export default async function handler(req, res) {
  try {
    const query = sanitizeText(req.query.q);
    if (!query) return res.status(400).json({ error: "Missing q" });

    const token = await getEbayAccessToken();

    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=6`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_CA"
      }
    });

    const data = await response.json();

    const items = (data.itemSummaries || []).map(item => ({
      id: item.itemId,
      title: item.title,
      imageUrl: item.image?.imageUrl,
      priceText: item.price ? `${item.price.value} ${item.price.currency}` : "N/A",
      subtitle: item.condition || "Item",
      source: "eBay",
      itemUrl: item.itemWebUrl,
      query
    })).filter(i => i.imageUrl && i.itemUrl);

    res.status(200).json({ items });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
