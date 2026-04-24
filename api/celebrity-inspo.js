function clean(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function makeId(value) {
  return Buffer.from(value).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 28);
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
      ? rawQueries
          .split("|||")
          .map(q => clean(q))
          .filter(Boolean)
          .slice(0, 4)
      : [`${celebrity} outfit street style`];

    const allItems = [];

    for (const query of queries) {
      const searchQuery = query.toLowerCase().includes(celebrity.toLowerCase())
        ? query
        : `${celebrity} ${query} outfit street style`;

      const url = new URL("https://serpapi.com/search.json");
      url.searchParams.set("engine", "google_images");
      url.searchParams.set("q", searchQuery);
      url.searchParams.set("api_key", process.env.SERPAPI_API_KEY);
      url.searchParams.set("ijn", "0");
      url.searchParams.set("safe", "active");

      const response = await fetch(url.toString());
      const data = await response.json();

      if (!response.ok) {
        continue;
      }

      const images = Array.isArray(data.images_results)
        ? data.images_results
        : [];

      for (const item of images.slice(0, 4)) {
        const imageUrl = clean(item.original) || clean(item.thumbnail);
        const sourceUrl = clean(item.link) || clean(item.source);
        const title = clean(item.title, `${celebrity} outfit inspo`);
        const source = clean(item.source, "Inspo");

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

    const seen = new Set();
    const unique = [];

    for (const item of allItems) {
      const key = item.imageUrl;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(item);
      }
    }

    return res.status(200).json({
      items: unique.slice(0, 10)
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Server error"
    });
  }
}
