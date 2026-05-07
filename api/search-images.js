const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      return res.status(200).json({
        ok: true,
        message: "search-images endpoint is live. Use POST with { query }."
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({
        results: [],
        error: "Method not allowed"
      });
    }

    const apiKey = process.env.SERPAPI_KEY;

    if (!apiKey) {
      return res.status(500).json({
        results: [],
        error: "Missing SERPAPI_KEY"
      });
    }

    const query = cleanText(req.body?.query);

    if (!query) {
      return res.status(200).json({
        results: [],
        debug: "No query received"
      });
    }

    const url = new URL(SERPAPI_ENDPOINT);
    url.searchParams.set("engine", "google_images");
    url.searchParams.set("q", `${query} outfit fashion street style`);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("gl", "ca");
    url.searchParams.set("hl", "en");

    const response = await fetch(url.toString());
    const data = await response.json();

    if (!response.ok || data.error) {
      throw new Error(data.error || "SerpApi image search failed");
    }

    const images = Array.isArray(data.images_results)
      ? data.images_results
      : [];

    const results = images
      .slice(0, 40)
      .map((item, index) => {
        const imageUrl = cleanText(
          item.original ||
          item.thumbnail ||
          item.serpapi_thumbnail
        );

        return {
          id: cleanText(String(item.position || index)),
          title: cleanText(item.title) || query,
          imageUrl,
          sourceUrl: cleanText(item.link || item.source || imageUrl),
          sourceName: cleanText(item.source) || "Source"
        };
      })
      .filter(item => item.imageUrl);

    return res.status(200).json({
      results
    });
  } catch (error) {
    return res.status(500).json({
      results: [],
      error: error.message || "Image search failed"
    });
  }
}
