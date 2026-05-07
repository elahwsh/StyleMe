const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        error: "Method not allowed"
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "Missing GEMINI_API_KEY"
      });
    }

    const { imageUrl, title } = req.body || {};

    if (!imageUrl) {
      return res.status(400).json({
        error: "Missing imageUrl"
      });
    }

    const prompt = `
You are VibeShop.

Analyze this fashion image like an elite stylist and luxury fashion buyer.

Your goal:
- identify the EXACT garments
- identify the EXACT silhouette
- identify the EXACT fit
- identify the EXACT length
- identify the EXACT texture/fabric
- identify the EXACT colors
- identify the EXACT outfit proportions

You MUST prioritize:
1. exactness
2. realism
3. accurate shopping recreation

CRITICAL:
- avoid vague descriptions
- avoid generic categories
- avoid alternative styles
- avoid mismatching fabrics
- avoid mismatching lengths
- avoid mismatching silhouettes
- avoid mismatching patterns

If the image shows:
- solid charcoal micro mini skirt
DO NOT suggest:
- plaid skirt
- satin skirt
- midi skirt
- knit skirt
- pencil skirt

Return ONLY valid JSON.

{
  "title": "",
  "vibe": "",
  "colors": [],
  "top": "",
  "bottom": "",
  "outerwear": "",
  "shoes": "",
  "accessories": [],
  "stylistNotes": {
    "silhouette": "",
    "colorLogic": "",
    "textureLogic": "",
    "fitLogic": ""
  },
  "shopFor": [
    {
      "query": "",
      "category": "",
      "reason": "",
      "tier": ""
    }
  ]
}

REQUIRED CATEGORIES:
- top
- bottom
- outerwear
- shoes
- accessory

Generate at least:
- 2 top searches
- 2 bottom searches
- 2 outerwear searches
- 2 shoe searches
- 2 accessory searches

Every query MUST:
- include exact color
- include exact fit
- include exact length
- include exact structure
- include exact texture
- include exact silhouette
- include "solid" or "no pattern" when relevant

GOOD:
"charcoal gray ultra micro straight tailored mini skirt solid"

BAD:
"gray mini skirt"

Do not explain anything outside JSON.
`;

    const response = await fetch(
      `${GEMINI_URL}?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `${prompt}\nImage title: ${title || ""}`
                },
                {
                  fileData: {
                    mimeType: "image/jpeg",
                    fileUri: imageUrl
                  }
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.3,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        error:
          data.error?.message ||
          "Gemini request failed"
      });
    }

    const text =
      data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

    const parsed = JSON.parse(text);

    return res.status(200).json(parsed);

  } catch (error) {
    return res.status(500).json({
      error:
        error.message ||
        "Gemini analyze failed"
    });
  }
}
