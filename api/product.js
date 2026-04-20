let ebayTokenCache = {
  accessToken: null,
  expiresAt: 0
};

function sanitizeText(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function safeLimit(value, min = 1, max = 12, fallback = 6) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function shorten(text, max = 90) {
  const value = sanitizeText(text);
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trim()}…`;
}

async function getEbayAccessToken() {
  const now = Date.now();

  if (ebayTokenCache.accessToken && now < ebayTokenCache.expiresAt) {
    return ebayTokenCache.accessToken;
  }

  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
    throw new Error("Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET");
  }

  const basic = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
  ).toString("base64");

  const tokenResponse = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope"
    }).toString()
  });

  const tokenData = await tokenResponse.json();

  if (!tokenResponse.ok || !tokenData.access_token) {
    throw new Error(tokenData.error_description || tokenData.error || "Could not get eBay token");
  }

  const expiresInSeconds = Number(tokenData.expires_in || 7200);
  ebayTokenCache = {
    accessToken: tokenData.access_token,
    expiresAt: now + Math.max(60, (expiresInSeconds - 120)) * 1000
  };

  return ebayTokenCache.accessToken;
}

function mapItem(item, query) {
  const title = sanitizeText(item.title, "Untitled item");
  const imageUrl =
    sanitizeText(item?.image?.imageUrl) ||
    sanitizeText(item?.additionalImages?.[0]?.imageUrl);

  const amount = item?.price?.value;
  const currency = sanitizeText(item?.price?.currency);
  const priceText = amount != null && currency
    ? `${amount} ${currency}`
    : "Price unavailable";

  const source = "eBay";
  const itemUrl = sanitizeText(item?.itemWebUrl);
  const subtitle =
    sanitizeText(item?.condition) ||
    sanitizeText(item?.itemLocation?.country) ||
    "Matching style item";

  if (!imageUrl || !itemUrl) return null;

  return {
    id: sanitizeText(item.itemId, `${title}|${itemUrl}`),
    title: shorten(title, 100),
    imageUrl,
    priceText,
    subtitle,
    source,
    itemUrl,
    query
  };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const query = sanitizeText(req.query.q);
    const limit = safeLimit(req.query.limit, 1, 12, 6);

    if (!query) {
      return res.status(400).json({ error: "Missing q" });
    }

    const accessToken = await getEbayAccessToken();

    const endpoint = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("limit", String(limit));

    const response = await fetch(endpoint.toString(), {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_CA",
        "Accept": "application/json"
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.errors?.[0]?.message || "eBay product search failed",
        raw: data
      });
    }

    const items = Array.isArray(data.itemSummaries)
      ? data.itemSummaries
          .map(item => mapItem(item, query))
          .filter(Boolean)
      : [];

    return res.status(200).json({ items });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Server error"
    });
  }
}
