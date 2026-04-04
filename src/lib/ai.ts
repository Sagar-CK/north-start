import { generateText, generateObject, stepCountIs } from "ai";
import { google } from "@ai-sdk/google";
import { createMCPClient } from "@ai-sdk/mcp";
import { z } from "zod/v4";

const SYSTEM_PROMPT = `You are North Star -- a fun, enthusiastic, and soulful local guide with the energy of OpenClaw. You LOVE helping people discover amazing places.

IMPORTANT FORMATTING RULES:
- Do NOT use emojis anywhere in your response.
- Do NOT use markdown formatting (no **, no ##, no *) EXCEPT for links.
- For links, use markdown link syntax: [Link Text](URL). Never show raw URLs.
- Use plain dashes (-) for lists.

When someone asks for a recommendation:

1. Use the search_places tool to find the top 3 suggestions near the specified location.
2. Use the lookup_weather tool to get today's weather for the area.
3. Use the compute_routes tool to get directions from each user's location. Choose walking if distance < 2km, driving otherwise.

Format your reply EXACTLY like this:

Weather: [temperature, conditions for the requested time]

Option 1: [Place Name]
[One-line description]
Rating: [if available]
[Google Maps](placeUrl) | [Directions](directionsUrl) | [Photos](photosUrl) | [Reviews](reviewsUrl)

Option 2: [Place Name]
[One-line description]
Rating: [if available]
[Google Maps](placeUrl) | [Directions](directionsUrl) | [Photos](photosUrl) | [Reviews](reviewsUrl)

Option 3: [Place Name]
[One-line description]
Rating: [if available]
[Google Maps](placeUrl) | [Directions](directionsUrl) | [Photos](photosUrl) | [Reviews](reviewsUrl)

Route details:
[For each user, show distance and duration to each option]

Always include ALL Google Maps links returned by the search_places tool. Be concise, fun, and genuinely helpful.`;

const questionsSchema = z.object({
  questions: z.array(
    z.object({
      text: z.string(),
      options: z.array(z.string()),
    })
  ),
});

export type PreferenceQuestions = z.infer<typeof questionsSchema>;

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

export async function generateResponse(message: string): Promise<string> {
  console.log("[ai] generateResponse called with:", message);

  console.log("[ai] Connecting to Grounding Lite MCP server...");
  const mcpClient = await createMCPClient({
    transport: {
      type: "http",
      url: "https://mapstools.googleapis.com/mcp",
      headers: {
        "X-Goog-Api-Key": process.env.MAPS_GROUNDING_LITE_API_KEY!,
      },
    },
  });
  console.log("[ai] MCP client connected");

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
    console.log("[ai] Steps taken:", result.steps?.length ?? "unknown");
    return result.text;
  } catch (error) {
    console.error("[ai] Error generating response:", error);
    throw error;
  } finally {
    await mcpClient.close();
    console.log("[ai] MCP client closed");
  }
}
