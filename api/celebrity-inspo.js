function clean(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function makeId(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 28);
}

function normalize(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "";
  }
}

function getImportantWords(query, celebrity) {
  const banned = new Set([
    ...celebrity.toLowerCase().split(" "),
    "outfit", "style", "street", "wearing", "wears", "look",
    "fashion", "celebrity", "inspo", "inspiration", "the", "and",
    "with", "for", "her", "his", "this", "that"
  ]);

  return normalize(query)
    .split(" ")
    .filter(word => word.length > 3 && !banned.has(word));
}

function isBadResult(item, celebrity, query) {
  const title = normalize(item.title);
  const source = normalize(item.source);
  const link = clean(item.link).toLowerCase();
  const combined = `${title} ${source} ${link}`;

  const bannedSources = [
    "facebook",
    "instagram",
    "tiktok",
    "pinterest",
    "reddit",
    "youtube",
    "shop",
    "store",
    "sale",
    "resell",
    "depop",
    "poshmark",
    "ebay",
    "amazon",
    "walmart",
    "quiz",
    "game",
    "wiki",
    "engagement ring",
    "boyfriend",
    "dating",
    "news only"
  ];

  if (bannedSources.some(word => combined.includes(word))) {
    return true;
  }

  const celebParts = celebrity.toLowerCase().split(" ").filter(Boolean);
  const mentionsCelebrity =
    celebParts.some(part => title.includes(part)) ||
    celebParts.some(part => link.includes(part));

  if (!mentionsCelebrity) return true;

  const image = clean(item.thumbnail) || clean(item.original);
  if (!image) return true;

  const importantWords = getImportantWords(query, celebrity);

  const clothingWords = [
    "skirt", "mini", "dress", "corset", "blazer", "jacket",
    "leather", "denim", "jeans", "pants", "trousers", "boots",
    "heels", "flats", "sneakers", "tank", "crop", "top",
    "black", "white", "cream", "silver", "gold", "oversized",
    "fitted", "sunglasses", "jewelry"
  ];

  const relevantWords = importantWords.filter(word =>
    clothingWords.includes(word) || clothingWords.some(c => word.includes(c) || c.includes(word))
  );

  if (relevantWords.length > 0) {
    const matches = relevantWords.filter(word => combined.includes(word));
    if (matches.length === 0) return true;
  }

  return false;
}

function similarity(a, b) {
  const aw = new Set(normalize(a).split(" ").filter(w => w.length > 2));
  const bw = new Set(normalize(b).split(" ").filter(w => w.length > 2));

  if (aw.size === 0 || bw.size === 0) return 0;

  let same = 0;
  for (const word of aw) {
    if (bw.has(word)) same++;
  }

  return same / Math.min(aw.size, bw.size);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (!process.env.SERPAPI_API_KEY) {
      return res.status(500).json({ error: "Missing SERPAPI_API_KEY" });
    }

    const celebrity = clean(req.query.celebrity);
    const rawQueries = clean(req.query.queries);

    if (!celebrity) {
      return res.status(400).json({ error: "Missing celebrity" });
    }

    const queries = rawQueries
      ? rawQueries.split("|||").map(q => clean(q)).filter(Boolean).slice(0, 4)
      : [`${celebrity} street style outfit`];

    const allItems = [];

    for (const query of queries) {
      const searchQuery = `${query} celebrity outfit -facebook -instagram -tiktok -pinterest -shop -resell`;

      const url = new URL("https://serpapi.com/search.json");
      url.searchParams.set("engine", "google_images");
      url.searchParams.set("q", searchQuery);
      url.searchParams.set("api_key", process.env.SERPAPI_API_KEY);
      url.searchParams.set("ijn", "0");
      url.searchParams.set("safe", "active");

      const response = await fetch(url.toString());
      const data = await response.json();

      if (!response.ok) continue;

      const images = Array.isArray(data.images_results) ? data.images_results : [];

      for (const item of images.slice(0, 30)) {
        if (isBadResult(item, celebrity, query)) continue;

        const imageUrl = clean(item.thumbnail) || clean(item.original);
        const sourceUrl = clean(item.link);
        const title = clean(item.title, `${celebrity} outfit inspo`);
        const source = clean(item.source, "Celebrity Inspo");

        allItems.push({
          id: makeId(imageUrl + sourceUrl + title),
          title,
          imageUrl,
          sourceUrl,
          source,
          query: searchQuery
        });
      }
    }

    const unique = [];

    for (const item of allItems) {
      const itemDomain = domainOf(item.sourceUrl);
      const itemImage = item.imageUrl.split("?")[0];

      const duplicate = unique.some(existing => {
        const existingDomain = domainOf(existing.sourceUrl);
        const existingImage = existing.imageUrl.split("?")[0];

        return (
          existingImage === itemImage ||
          similarity(existing.title, item.title) >= 0.55 ||
          (existingDomain === itemDomain && similarity(existing.title, item.title) >= 0.35)
        );
      });

      if (!duplicate) unique.push(item);
      if (unique.length >= 3) break;
    }

    return res.status(200).json({
      items: unique
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Server error"
    });
  }
}
