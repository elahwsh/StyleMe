function sanitizeText(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function priceToText(price) {
  const amount = sanitizeText(price?.amount);
  const currency = sanitizeText(price?.currencyCode);

  if (!amount || !currency) return "Price unavailable";
  return `${amount} ${currency}`;
}

function bestImage(product) {
  const featured = sanitizeText(product?.featuredImage?.url);
  if (featured) return featured;

  const firstEdge = product?.images?.edges?.[0]?.node?.url;
  return sanitizeText(firstEdge);
}

function firstVariantPrice(product) {
  return product?.variants?.edges?.[0]?.node?.price || null;
}

function collectTags(product) {
  return Array.isArray(product?.tags)
    ? product.tags.filter(tag => typeof tag === "string" && tag.trim())
    : [];
}

function shortSubtitle(product, storeName) {
  const productType = sanitizeText(product?.productType);
  const vendor = sanitizeText(product?.vendor);
  const pieces = [vendor, productType, storeName].filter(Boolean);
  return pieces.join(" • ") || "Fashion item";
}

export function normalizeShopifyProduct(product, store) {
  const title = sanitizeText(product?.title, "Untitled item");
  const itemUrl = sanitizeText(product?.onlineStoreUrl);
  const imageUrl = bestImage(product);
  const tags = collectTags(product);
  const price = firstVariantPrice(product);

  if (!itemUrl || !imageUrl) return null;

  return {
    id: sanitizeText(product?.id, `${store.name}|${title}|${itemUrl}`),
    title,
    imageUrl,
    priceText: priceToText(price),
    subtitle: shortSubtitle(product, store.name),
    source: store.name,
    itemUrl,
    query: "",
    brand: sanitizeText(product?.vendor),
    category: sanitizeText(product?.productType),
    colorTags: tags,
    rawTags: tags
  };
}
