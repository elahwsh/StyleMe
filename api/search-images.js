const SERPER_ENDPOINT =
  "https://google.serper.dev/images";

function cleanText(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function buildFashionQuery(query) {
  return [
    query,
    "fashion outfit street style",
    "full body",
    "-cartoon",
    "-anime",
    "-drawing",
    "-illustration",
    "-clipart"
  ].join(" ");
}

function isBadResult(item) {
  const title = cleanText(item.title).toLowerCase();
  const source = cleanText(item.source).toLowerCase();
  const link = cleanText(item.link).toLowerCase();

  const blocked = [
    "cartoon",
    "drawing",
    "illustration",
    "anime",
    "clipart",
    "template",
    "png",
    "transparent"
  ];

  return blocked.some(word =>
    title.includes(word) ||
    source.includes(word) ||
    link.includes(word)
  );
}

function normalizeResult(item, index, query) {
  const imageUrl =
    cleanText(item.imageUrl) ||
    cleanText(item.thumbnailUrl);

  if (!imageUrl) return null;

  return {
    id: String(index),
    title:
      cleanText(item.title) ||
      query,
    imageUrl,
    sourceUrl:
      cleanText(item.link) ||
      imageUrl,
    sourceName:
      cleanText(item.source) ||
      "Source"
  };
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      return res.status(200).json({
        ok: true,
        message:
          "search-images endpoint live"
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({
        results: [],
        error: "Method not allowed"
      });
    }

    const apiKey =
      process.env.SERPER_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        results: [],
        error:
          "Missing SERPER_API_KEY"
      });
    }

    const query = cleanText(req.body?.query);

    if (!query) {
      return res.status(200).json({
        results: []
      });
    }

    const response = await fetch(
      SERPER_ENDPOINT,
      {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify({
          q: buildFashionQuery(query),
          gl: "ca",
          hl: "en"
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.message ||
        "Serper image search failed"
      );
    }

    const images = Array.isArray(data.images)
      ? data.images
      : [];

    const results = images
      .filter(item => !isBadResult(item))
      .map((item, index) =>
        normalizeResult(item, index, query)
      )
      .filter(Boolean)
      .slice(0, 40);

    return res.status(200).json({
      results,
      debug: {
        query,
        total: results.length
      }
    });
  } catch (error) {
    return res.status(500).json({
      results: [],
      error:
        error.message ||
        "Image search failed"
    });
  }
}
