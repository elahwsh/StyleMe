const SERPER_ENDPOINT = "https://google.serper.dev/images";

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        results: [],
        error: "Method not allowed"
      });
    }

    const apiKey = process.env.SERPER_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        results: [],
        error: "Missing SERPER_API_KEY"
      });
    }

    const query = cleanText(req.body?.query);

    if (!query) {
      return res.status(200).json({ results: [] });
    }

    const response = await fetch(SERPER_ENDPOINT, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        q: `${query} fashion outfit street style`,
        gl: "ca",
        hl: "en",
        num: 40
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Serper image search failed");
    }

    const images = Array.isArray(data.images) ? data.images : [];

    const results = images
      .map((item, index) => ({
        id: `${query}-${index}`,
        title: cleanText(item.title) || query,
        imageUrl: cleanText(item.imageUrl),
        sourceUrl: cleanText(item.link),
        sourceName: cleanText(item.source)
      }))
      .filter(item => item.imageUrl && item.sourceUrl);

    return res.status(200).json({ results });
  } catch (error) {
    return res.status(500).json({
      results: [],
      error: error.message || "Image search failed"
    });
  }
}
