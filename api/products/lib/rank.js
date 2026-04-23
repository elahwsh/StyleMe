function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function overlapScore(a, b) {
  const aSet = new Set(tokenize(a));
  const bTokens = tokenize(b);
  let score = 0;

  for (const token of bTokens) {
    if (aSet.has(token)) score += 1;
  }

  return score;
}

function uniqueProducts(items) {
  const seen = new Set();
  const output = [];

  for (const item of items) {
    const key = `${String(item.title).toLowerCase()}|${String(item.itemUrl).toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      output.push(item);
    }
  }

  return output;
}

export function rankProducts(items, query) {
  const q = String(query || "").trim();

  return uniqueProducts(items)
    .map(item => {
      let score = 0;

      score += overlapScore(item.title, q) * 6;
      score += overlapScore(item.subtitle, q) * 3;
      score += overlapScore(item.brand, q) * 2;
      score += overlapScore(item.category, q) * 2;

      if (Array.isArray(item.colorTags)) {
        score += item.colorTags.join(" ").toLowerCase().includes(q.toLowerCase()) ? 3 : 0;
      }

      if (/dress|blazer|trouser|jean|coat|skirt|heel|boot|bag|top|shirt|jacket|sweater/.test(item.title.toLowerCase())) {
        score += 1;
      }

      return {
        ...item,
        query,
        _rank: score
      };
    })
    .sort((a, b) => b._rank - a._rank)
    .map(({ _rank, ...item }) => item);
}
