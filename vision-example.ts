import { Type, Static } from 'typebox';
import { Value } from 'typebox/value';

// 1. Define the exact structure you want back from your image
const ReceiptAnalysisSchema = Type.Object({
  merchant: Type.String({ description: "The name of the store or merchant" }),
  date: Type.String({ description: "Date of transaction if visible, otherwise 'unknown'" }),
  items: Type.Array(
    Type.Object({
      name: Type.String({ description: "Item description" }),
      price: Type.Number({ description: "The unit or total price for this item" })
    }),
    { description: "List of all line items on the receipt" }
  ),
  total: Type.Number({ description: "The grand total value" })
});

type ReceiptAnalysis = Static<typeof ReceiptAnalysisSchema>;

async function analyzeReceiptImage(base64Image: string): Promise<ReceiptAnalysis | null> {
  const apiKey = Bun.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY environment variable.");
  }

  // 2. OpenRouter uses the standard OpenAI payload format via its base URL
  const response = await fetch("https://openrouter.ai", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      // OpenRouter optional headers to show up on your dashboard ranking
      "HTTP-Referer": "https://localhost:3000",
      "X-Title": "Bun Typebox Client"
    },
    body: JSON.stringify({
      // Using Gemini Flash - the best value-to-cost model for vision + structured data
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract all items, totals, and storefront info from this receipt photo."
            },
            {
              type: "image_url",
              image_url: {
                // Image must be a standard base64 data URI string or a public URL
                url: `data:image/jpeg;base64,${base64Image}`
              }
            }
          ]
        }
      ],
      // Enforce strict schema constraints directly through OpenRouter's proxy layer
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "receipt_analysis",
          strict: true,
          schema: ReceiptAnalysisSchema // TypeBox object passes seamlessly as pure JSON Schema
        }
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter Error: ${response.status} - ${errorText}`);
  }

  const json = await response.json();
  const rawContent = json.choices?.[0]?.message?.content;

  if (!rawContent) {
    console.error("Model returned a blank string.");
    return null;
  }

  try {
    const parsedData = JSON.parse(rawContent);

    // 3. Perform native, zero-dependency validation using typebox/value
    const isValid = Value.Check(ReceiptAnalysisSchema, parsedData);

    if (isValid) {
      return parsedData as ReceiptAnalysis;
    } else {
      const errors = [...Value.Errors(ReceiptAnalysisSchema, parsedData)];
      console.error("OpenRouter payload broke the target typebox schema:", errors);
      return null;
    }
  } catch (error) {
    console.error("Failed to parse raw text response block into JSON:", error);
    return null;
  }
}

// --- Execution Helper Example ---
// For testing, mock a tiny transparent 1x1 pixel base64 string
const mockBase64Image = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const result = await analyzeReceiptImage(mockBase64Image);
if (result) {
  console.log(`Success! Merchant name typed as string: ${result.merchant.toUpperCase()}`);
}
