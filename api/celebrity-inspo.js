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

function isObviouslyBad(item, celebrity) {
  const title = normalize(item.title);
  const source = normalize(item.source);
  const link = clean(item.link).toLowerCase();
  const combined = `${title} ${source} ${link}`;

  const banned = [
    "facebook",
    "tiktok",
    "reddit",
    "youtube",
    "quiz",
    "game",
    "wiki",
    "boyfriend",
    "engagement",
    "dating",
    "adult",
    "porn",
    "nsfw"
  ];

  if (banned.some(word => combined.includes(word))) {
    return true;
  }

  const celebWords = celebrity.toLowerCase().split(" ").filter(Boolean);

  const mentionsCelebrity =
    celebWords.some(word => title.includes(word)) ||
    celebWords.some(word => link.includes(word));

  return !mentionsCelebrity;
}

function isDuplicate(candidate, selected) {
  const candidateTitle = normalize(candidate.title);
  const candidateImage = candidate.imageUrl.split("?")[0];
  const candidateSource = normalize(candidate.source);

  return selected.some(item => {
    const itemTitle = normalize(item.title);
    const itemImage = item.imageUrl.split("?")[0];
    const itemSource = normalize(item.source);

    if (candidateImage === itemImage) return true;

    if (
      candidateTitle &&
      itemTitle &&
      candidateTitle.slice(0, 50) === itemTitle.slice(0, 50)
    ) {
      return true;
    }

    if (
      candidateSource === itemSource &&
      candidateTitle.split(" ").slice(0, 5).join(" ") ===
        itemTitle.split(" ").slice(0, 5).join(" ")
    ) {
      return true;
    }

    return false;
  });
}

function scoreCandidate(item) {
  const title = normalize(item.title);
  const source = normalize(item.source);
  const link = clean(item.sourceUrl).toLowerCase();

  let score = 0;

  if (title.includes("outfit")) score += 4;
  if (title.includes("street style")) score += 4;
  if (title.includes("style")) score += 2;
  if (title.includes("wears")) score += 2;
  if (title.includes("wearing")) score += 2;
  if (title.includes("look")) score += 1;

  if (source.includes("vogue")) score += 5;
  if (source.includes("elle")) score += 5;
  if (source.includes("harper")) score += 5;
  if (source.includes("who what wear")) score += 4;
  if (source.includes("instyle")) score += 4;
  if (source.includes("people")) score += 3;
  if (source.includes("glamour")) score += 3;
  if (source.includes("yahoo")) score += 2;

  if (link.includes("instagram")) score -= 4;
  if (link.includes("pinterest")) score -= 3;
  if (link.includes("shop")) score -= 3;
  if (link.includes("resell")) score -= 4;

  return score;
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

    const allCandidates = [];

    for (const query of queries) {
      const searchQuery = query.toLowerCase().includes(celebrity.toLowerCase())
        ? `${query} outfit street style`
        : `${celebrity} ${query} outfit street style`;

      const url = new URL("https://serpapi.com/search.json");
      url.searchParams.set("engine", "google_images");
      url.searchParams.set("q", searchQuery);
      url.searchParams.set("api_key", process.env.SERPAPI_API_KEY);
      url.searchParams.set("ijn", "0");
      url.searchParams.set("safe", "active");

      const response = await fetch(url.toString());
      const data = await response.json();

      if (!response.ok) continue;

      const images = Array.isArray(data.images_results)
        ? data.images_results
        : [];

      for (const item of images.slice(0, 10)) {
        if (isObviouslyBad(item, celebrity)) continue;

        const imageUrl = clean(item.thumbnail) || clean(item.original);
        const sourceUrl = clean(item.link);
        const title = clean(item.title, `${celebrity} outfit inspo`);
        const source = clean(item.source, "Celebrity Inspo");

        if (!imageUrl || !sourceUrl) continue;

        const candidate = {
          id: makeId(imageUrl + sourceUrl + title),
          title,
          imageUrl,
          sourceUrl,
          source,
          query: searchQuery
        };

        candidate.score = scoreCandidate(candidate);

        if (!isDuplicate(candidate, allCandidates)) {
          allCandidates.push(candidate);
        }
      }
    }

    allCandidates.sort((a, b) => b.score - a.score);

    const finalItems = [];

    for (const item of allCandidates) {
      if (!isDuplicate(item, finalItems)) {
        finalItems.push({
          id: item.id,
          title: item.title,
          imageUrl: item.imageUrl,
          sourceUrl: item.sourceUrl,
          source: item.source,
          query: item.query
        });
      }

      if (finalItems.length >= 4) break;
    }

    return res.status(200).json({
      items: finalItems
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Server error"
    });
  }
}
