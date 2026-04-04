import { generateText, generateObject, stepCountIs } from "ai";
import { google } from "@ai-sdk/google";
import { createMCPClient } from "@ai-sdk/mcp";
import { z } from "zod/v4";

const SYSTEM_PROMPT = `You are North Star -- a warm, witty local guide who genuinely loves helping people find great spots. You talk like a friend who just moved to the city and can't stop telling everyone about the gems you've found.

Your personality:
- Conversational and human -- like texting a friend, not reading a brochure
- You have real opinions and aren't afraid to share them
- You notice the little details that make a place special
- You're excited but not over-the-top

When someone asks for a recommendation:
1. Use search_places to find the top 3 spots near the specified location.
2. Use lookup_weather for the weather at the requested time.
3. Use compute_routes from each user's location. Walk if < 2km, drive otherwise.

IMPORTANT: Return your response as valid JSON matching this exact schema:
{
  "weather": "short weather summary, like: 72F and sunny, perfect evening out",
  "intro": "a one-line conversational opener about the search, like a friend would say",
  "places": [
    {
      "name": "Place Name",
      "vibe": "a short, vivid, human description -- what makes this place special. 1-2 sentences max. Sound like you've actually been there.",
      "rating": "4.5/5" or null,
      "googleMapsUrl": "url",
      "directionsUrl": "url",
      "photosUrl": "url",
      "reviewsUrl": "url",
      "routes": [
        { "userName": "name", "mode": "walk or drive", "distance": "0.8 km", "duration": "12 min" }
      ]
    }
  ],
  "signoff": "a short, warm closing line -- like a friend sending you off"
}

Make the vibe descriptions feel real and specific. Not "great Italian restaurant" but "the kind of place where the pasta is handmade and the owner will come chat with you about his grandmother's recipe."`;

const questionsSchema = z.object({
  questions: z.array(
    z.object({
      text: z.string(),
      options: z.array(z.string()),
    })
  ),
});

export type PreferenceQuestions = z.infer<typeof questionsSchema>;

const placesResponseSchema = z.object({
  weather: z.string(),
  intro: z.string(),
  places: z.array(
    z.object({
      name: z.string(),
      vibe: z.string(),
      rating: z.string().nullable(),
      googleMapsUrl: z.string().optional(),
      directionsUrl: z.string().optional(),
      photosUrl: z.string().optional(),
      reviewsUrl: z.string().optional(),
      routes: z.array(
        z.object({
          userName: z.string(),
          mode: z.string(),
          distance: z.string(),
          duration: z.string(),
        })
      ).optional(),
    })
  ),
  signoff: z.string(),
});

export type PlacesResponse = z.infer<typeof placesResponseSchema>;

export async function generatePreferenceQuestions(
  request: string
): Promise<PreferenceQuestions> {
  const result = await generateObject({
    model: google("gemini-2.5-flash"),
    schema: questionsSchema,
    prompt: `You are planning a group outing. Based on this request: "${request}"

Generate exactly 3 preference questions to ask the group.

RULES:
- Each question must cover a DIFFERENT dimension (e.g. type/category, timing, style). Do NOT ask two questions about the same thing.
- Each question should have 4-6 options.
- Option labels MUST be short -- max 2 words each (e.g. "Italian", "Late Night", "Casual", "Under $20"). Never use full sentences as options.
- Do not use emojis in questions or options.

Examples of good question sets:
- Dinner: "Cuisine?" [Italian, Indian, Japanese, Mexican, Thai] / "When?" [Lunch, Dinner, Late Night] / "Vibe?" [Casual, Upscale, Outdoor, Cozy]
- Running: "When?" [Morning, Afternoon, Evening] / "Terrain?" [Trail, Street, Track, Park] / "Distance?" [Short, Medium, Long]
- Activity: "Type?" [Museum, Shopping, Hiking, Games] / "Budget?" [Free, Under $20, Any] / "Setting?" [Indoor, Outdoor, Either]`,
  });

  return result.object;
}

export async function generatePlacesResponse(message: string): Promise<PlacesResponse> {
  console.log("[ai] generatePlacesResponse called");

  const mcpClient = await createMCPClient({
    transport: {
      type: "http",
      url: "https://mapstools.googleapis.com/mcp",
      headers: {
        "X-Goog-Api-Key": process.env.MAPS_GROUNDING_LITE_API_KEY!,
      },
    },
  });

  try {
    const tools = await mcpClient.tools();
    console.log("[ai] MCP tools loaded:", Object.keys(tools));

    const result = await generateText({
      model: google("gemini-2.5-flash"),
      system: SYSTEM_PROMPT,
      prompt: message,
      tools,
      stopWhen: stepCountIs(5),
    });

    console.log("[ai] Gemini response received, length:", result.text.length);

    // Parse the JSON from the response
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return placesResponseSchema.parse(JSON.parse(jsonMatch[0]));
    }

    // Fallback: try parsing the whole thing
    return placesResponseSchema.parse(JSON.parse(result.text));
  } catch (error) {
    console.error("[ai] Error generating places response:", error);
    throw error;
  } finally {
    await mcpClient.close();
  }
}

export async function generateResponse(message: string): Promise<string> {
  console.log("[ai] generateResponse called with:", message);

  const mcpClient = await createMCPClient({
    transport: {
      type: "http",
      url: "https://mapstools.googleapis.com/mcp",
      headers: {
        "X-Goog-Api-Key": process.env.MAPS_GROUNDING_LITE_API_KEY!,
      },
    },
  });

  try {
    const tools = await mcpClient.tools();

    const result = await generateText({
      model: google("gemini-2.5-flash"),
      system: SYSTEM_PROMPT,
      prompt: message,
      tools,
      stopWhen: stepCountIs(5),
    });

    return result.text;
  } catch (error) {
    console.error("[ai] Error generating response:", error);
    throw error;
  } finally {
    await mcpClient.close();
  }
}
