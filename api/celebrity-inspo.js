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
    "dating"
  ];

  if (banned.some(word => combined.includes(word))) return true;

  const celebWords = celebrity.toLowerCase().split(" ").filter(Boolean);
  const mentionsCelebrity =
    celebWords.some(word => title.includes(word)) ||
    celebWords.some(word => link.includes(word));

  return !mentionsCelebrity;
}

function isDuplicate(candidate, selected) {
  const title = normalize(candidate.title);
  const image = candidate.imageUrl.split("?")[0];

  return selected.some(item => {
    const otherTitle = normalize(item.title);
    const otherImage = item.imageUrl.split("?")[0];

    if (image === otherImage) return true;
    if (title && otherTitle && title.slice(0, 45) === otherTitle.slice(0, 45)) return true;

    return false;
  });
}

async function aiFilterCandidates({ celebrity, queries, candidates }) {
  if (!process.env.OPENAI_API_KEY) {
    return candidates.slice(0, 4);
  }

  const candidateText = candidates
    .map((item, index) => {
      return `${index}: title="${item.title}", source="${item.source}", query="${item.query}"`;
    })
    .join("\n");

  const prompt = `
You are filtering celebrity outfit inspiration results.

Celebrity: ${celebrity}

The user wants images of this celebrity wearing outfits similar to:
${queries.join("\n")}

Candidates:
${candidateText}

Return JSON only:
{
  "keepIndexes": [0, 1, 2]
}

Rules:
- Keep only images that are likely actual outfit inspiration of ${celebrity}.
- Remove unrelated news, engagement, random event photos, duplicate-looking results, shopping/resell pages.
- Prefer street style, outfit articles, paparazzi style, fashion magazine outfit references.
- Prefer results matching the clothing terms in the queries.
- Keep max 4.
- If unsure, keep fewer.
`;

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        text: {
          format: { type: "json_object" }
        },
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: prompt }
            ]
          }
        ]
      })
    });

    const data = await response.json();

    const outputText =
      data.output_text ??
      data.output
        ?.flatMap(item => item.content ?? [])
        ?.map(content => content.text || "")
        ?.join("")
        ?.trim();

    if (!response.ok || !outputText) {
      return candidates.slice(0, 4);
    }

    const parsed = JSON.parse(outputText);
    const indexes = Array.isArray(parsed.keepIndexes) ? parsed.keepIndexes : [];

    const selected = indexes
      .filter(index => Number.isInteger(index))
      .map(index => candidates[index])
      .filter(Boolean)
      .slice(0, 4);

    return selected.length > 0 ? selected : candidates.slice(0, 4);
  } catch {
    return candidates.slice(0, 4);
  }
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

      for (const item of images.slice(0, 8)) {
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

        if (!isDuplicate(candidate, allCandidates)) {
          allCandidates.push(candidate);
        }
      }
    }

    const aiSelected = await aiFilterCandidates({
      celebrity,
      queries,
      candidates: allCandidates.slice(0, 12)
    });

    const finalItems = [];

    for (const item of aiSelected) {
      if (!isDuplicate(item, finalItems)) {
        finalItems.push(item);
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
