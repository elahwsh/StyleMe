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
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isBadResult(item, celebrity) {
  const title = normalize(item.title);
  const source = normalize(item.source);
  const link = clean(item.link).toLowerCase();

  const banned = [
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
    "limited resell",
    "depop",
    "poshmark",
    "ebay",
    "amazon",
    "walmart",
    "quiz",
    "game",
    "wiki"
  ];

  if (banned.some(word => title.includes(word) || source.includes(word) || link.includes(word))) {
    return true;
  }

  const celebParts = celebrity.toLowerCase().split(" ").filter(Boolean);
  const mentionsCelebrity = celebParts.some(part => title.includes(part)) || celebParts.some(part => link.includes(part));

  if (!mentionsCelebrity) return true;

  const image = clean(item.original) || clean(item.thumbnail);
  if (!image) return true;

  return false;
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
      const searchQuery = `${query} -facebook -instagram -tiktok -pinterest -resell -shop`;

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

      for (const item of images.slice(0, 20)) {
        if (isBadResult(item, celebrity)) continue;

        const imageUrl = clean(item.thumbnail) || clean(item.original);
        const sourceUrl = clean(item.link);
        const title = clean(item.title, `${celebrity} outfit inspo`);
        const source = clean(item.source, "Celebrity Inspo");

        if (!imageUrl || !sourceUrl) continue;

        allItems.push({
          id: makeId(imageUrl + sourceUrl),
          title,
          imageUrl,
          sourceUrl,
          source,
          query: searchQuery
        });
      }
    }

   const seenKeys = new Set();
const unique = [];

for (const item of allItems) {
  const titleKey = normalize(item.title)
    .replace(/\b(the|a|an|her|his|wears|wearing|like|pro|style|outfit)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 38);

  const sourceKey = normalize(item.source);
  const linkPath = clean(item.sourceUrl)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("?")[0]
    .split("#")[0];

  const combinedKey = `${titleKey}|${sourceKey}`;

  if (seenKeys.has(titleKey)) continue;
  if (seenKeys.has(combinedKey)) continue;
  if (seenKeys.has(linkPath)) continue;

  seenKeys.add(titleKey);
  seenKeys.add(combinedKey);
  seenKeys.add(linkPath);

  unique.push(item);
}

    return res.status(200).json({
      items: unique.slice(0, 6)
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Server error"
    });
  }
}
