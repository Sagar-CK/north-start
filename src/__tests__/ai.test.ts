import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock ai SDK's generateText
vi.mock("ai", () => ({
  generateText: vi.fn(),
  stepCountIs: vi.fn((n: number) => `stepCountIs(${n})`),
}));

// Mock @ai-sdk/google
vi.mock("@ai-sdk/google", () => ({
  google: vi.fn(() => "gemini-model-mock"),
}));

// Mock @ai-sdk/mcp
vi.mock("@ai-sdk/mcp", () => ({
  createMCPClient: vi.fn(),
}));

import { generateText } from "ai";
import { createMCPClient } from "@ai-sdk/mcp";
import { generateResponse } from "../lib/ai";

describe("generateResponse", () => {
  const mockTools = { search_places: {}, lookup_weather: {}, compute_routes: {} };

  beforeEach(() => {
    vi.clearAllMocks();

    const mockMcpClient = {
      tools: vi.fn().mockResolvedValue(mockTools),
      close: vi.fn(),
    };
    vi.mocked(createMCPClient).mockResolvedValue(mockMcpClient as any);

    vi.mocked(generateText).mockResolvedValue({
      text: "Here are 3 great spots near Union Square!",
    } as any);
  });

  it("returns a text response for a location query", async () => {
    const result = await generateResponse("find me a place to eat near Union Square");
    expect(result).toBe("Here are 3 great spots near Union Square!");
  });

  it("calls generateText with Gemini model, system prompt, and MCP tools", async () => {
    await generateResponse("find me parks near Union Square");

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-model-mock",
        system: expect.stringContaining("North Star"),
        prompt: "find me parks near Union Square",
        tools: mockTools,
        stopWhen: "stepCountIs(5)",
      })
    );
  });

  it("connects MCP client to Grounding Lite endpoint with API key", async () => {
    process.env.MAPS_GROUNDING_LITE_API_KEY = "test-maps-key";
    await generateResponse("find me coffee near Union Square");

    expect(createMCPClient).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: expect.objectContaining({
          type: "http",
          url: "https://mapstools.googleapis.com/mcp",
          headers: expect.objectContaining({
            "X-Goog-Api-Key": "test-maps-key",
          }),
        }),
      })
    );
  });

  it("closes the MCP client after generating a response", async () => {
    const mockClose = vi.fn();
    const mockMcpClient = {
      tools: vi.fn().mockResolvedValue(mockTools),
      close: mockClose,
    };
    vi.mocked(createMCPClient).mockResolvedValue(mockMcpClient as any);

    await generateResponse("find me a gym near Union Square");
    expect(mockClose).toHaveBeenCalled();
  });
});
