import { searchShopifyStores } from "./providers/shopifyProvider.js";
import { rankProducts } from "./lib/rank.js";

function sanitizeText(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function safeLimit(value, min = 1, max = 24, fallback = 12) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const query = sanitizeText(req.query.q);
    const limit = safeLimit(req.query.limit, 1, 24, 12);

    if (!query) {
      return res.status(400).json({ error: "Missing q" });
    }

    const storesJson = process.env.SHOPIFY_STORES_JSON;
    if (!storesJson) {
      return res.status(500).json({ error: "Missing SHOPIFY_STORES_JSON" });
    }

    let stores;
    try {
      stores = JSON.parse(storesJson);
    } catch {
      return res.status(500).json({ error: "Invalid SHOPIFY_STORES_JSON" });
    }

    if (!Array.isArray(stores) || stores.length === 0) {
      return res.status(500).json({ error: "No Shopify stores configured" });
    }

    const providerResults = await searchShopifyStores({
      stores,
      query,
      perStoreLimit: Math.min(8, limit)
    });

    const ranked = rankProducts(providerResults, query).slice(0, limit);

    return res.status(200).json({
      items: ranked,
      meta: {
        provider: "shopify",
        count: ranked.length,
        query
      }
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Server error"
    });
  }
}
