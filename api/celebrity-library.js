// /api/celebrity-library.js

import { celebrityOutfits } from "../lib/celebrityOutfits.js";

function normalize(text) {
  return text.toLowerCase().trim();
}

function scoreMatch(outfit, tagsToMatch) {
  const outfitTags = outfit.tags.map(normalize);

  let score = 0;

  tagsToMatch.forEach(tag => {
    const t = normalize(tag);

    if (outfitTags.some(oTag => oTag.includes(t) || t.includes(oTag))) {
      score += 1;
    }
  });

  return score;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { celebrityName, tagsToMatch } = req.body;

    if (!celebrityName || !tagsToMatch) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    // 1. Filter by celebrity
    const filtered = celebrityOutfits.filter(
      item => item.celebrity.toLowerCase() === celebrityName.toLowerCase()
    );

    // 2. Score
    const scored = filtered.map(item => ({
      ...item,
      matchScore: scoreMatch(item, tagsToMatch)
    }));

    // 3. Sort
    scored.sort((a, b) => b.matchScore - a.matchScore);

    // 4. Remove duplicates (by id)
    const seen = new Set();
    const unique = scored.filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });

    // 5. Filter weak matches
    const strongMatches = unique.filter(item => item.matchScore > 0);

    // 6. Limit results
    const results = strongMatches.slice(0, 6);

    return res.status(200).json({
      images: results.map(item => ({
        imageUrl: item.imageUrl,
        sourceUrl: item.sourceUrl,
        matchScore: item.matchScore
      }))
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Server error" });
  }
}
