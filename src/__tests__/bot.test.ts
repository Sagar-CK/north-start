import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("chat", () => {
  const handlers: Record<string, Function> = {};
  return {
    Chat: vi.fn().mockImplementation(() => ({
      onNewMention: vi.fn((handler: Function) => {
        handlers["onNewMention"] = handler;
      }),
      onSubscribedMessage: vi.fn((handler: Function) => {
        handlers["onSubscribedMessage"] = handler;
      }),
      webhooks: { telegram: vi.fn() },
      _handlers: handlers,
    })),
  };
});

vi.mock("@chat-adapter/telegram", () => ({
  createTelegramAdapter: vi.fn(() => "telegram-adapter-mock"),
}));

vi.mock("@chat-adapter/state-memory", () => ({
  createMemoryState: vi.fn(() => "memory-state-mock"),
}));

vi.mock("../lib/ai", () => ({
  generateResponse: vi.fn(),
}));

import { Chat } from "chat";
import { generateResponse } from "../lib/ai";

describe("bot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates Chat instance with telegram adapter and memory state", async () => {
    await import("../lib/bot");

    expect(Chat).toHaveBeenCalledWith(
      expect.objectContaining({
        adapters: expect.objectContaining({
          telegram: "telegram-adapter-mock",
        }),
        state: "memory-state-mock",
      })
    );
  });

  it("onNewMention subscribes, calls generateResponse, and posts reply", async () => {
    vi.mocked(generateResponse).mockResolvedValue("Here are your suggestions!");

    const botModule = await import("../lib/bot");
    const bot = botModule.bot as any;

    const handler = bot._handlers["onNewMention"];
    expect(handler).toBeDefined();

    const mockThread = {
      post: vi.fn(),
      subscribe: vi.fn(),
    };
    const mockMessage = { text: "find me a place to eat near Union Square" };

    await handler(mockThread, mockMessage);

    expect(mockThread.subscribe).toHaveBeenCalled();
    expect(generateResponse).toHaveBeenCalledWith("find me a place to eat near Union Square");
    expect(mockThread.post).toHaveBeenCalledWith("Here are your suggestions!");
  });

  it("onSubscribedMessage calls generateResponse and posts reply", async () => {
    vi.mocked(generateResponse).mockResolvedValue("More suggestions!");

    const botModule = await import("../lib/bot");
    const bot = botModule.bot as any;

    const handler = bot._handlers["onSubscribedMessage"];
    expect(handler).toBeDefined();

    const mockThread = { post: vi.fn() };
    const mockMessage = { text: "what about coffee shops?" };

    await handler(mockThread, mockMessage);

    expect(generateResponse).toHaveBeenCalledWith("what about coffee shops?");
    expect(mockThread.post).toHaveBeenCalledWith("More suggestions!");
  });
});
