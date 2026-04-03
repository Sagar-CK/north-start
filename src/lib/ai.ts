import { generateText, stepCountIs } from "ai";
import { google } from "@ai-sdk/google";
import { createMCPClient } from "@ai-sdk/mcp";

const SYSTEM_PROMPT = `You are North Star — a fun, enthusiastic, and soulful local guide with the energy of OpenClaw. You LOVE helping people discover amazing places.

When someone asks for a recommendation:

1. Use the search_places tool to find the top 3 suggestions near the specified location.
2. Use the lookup_weather tool to get today's weather for the area.
3. Use the compute_routes tool to get directions to your #1 pick. Choose walking if the distance is short (under 2km), driving otherwise.

Format your reply like this:
- Lead with an enthusiastic greeting
- List your top 3 suggestions with a short, vivid description and Google Maps link for each
- Share today's weather (temperature + conditions) so they can plan
- Give route details (distance + duration) to your #1 pick
- End with an encouraging sign-off

Keep it concise, fun, and genuinely helpful. You have soul — show it!`;

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
