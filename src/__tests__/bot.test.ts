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
      onAction: vi.fn((handler: Function) => {
        handlers["onAction"] = handler;
      }),
      openDM: vi.fn(),
      webhooks: { telegram: vi.fn() },
      _handlers: handlers,
    })),
    Card: vi.fn(({ title, children }) => ({ type: "card", title, children })),
    Actions: vi.fn((children) => ({ type: "actions", children })),
    Button: vi.fn((props) => ({ type: "button", ...props })),
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
  generatePreferenceQuestions: vi.fn(),
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

  it("DM mention uses direct response flow", async () => {
    vi.mocked(generateResponse).mockResolvedValue("Here are your suggestions!");

    const botModule = await import("../lib/bot");
    const bot = botModule.bot as any;

    const handler = bot._handlers["onNewMention"];
    expect(handler).toBeDefined();

    const mockThread = {
      post: vi.fn(),
      subscribe: vi.fn(),
      isDM: true,
    };
    const mockMessage = {
      text: "find me a place to eat near Union Square",
      author: { userId: "alice", fullName: "Alice" },
    };

    await handler(mockThread, mockMessage);

    expect(generateResponse).toHaveBeenCalledWith(
      "find me a place to eat near Union Square"
    );
    expect(mockThread.post).toHaveBeenCalledWith("Here are your suggestions!");
  });

  it("group mention starts a planning session", async () => {
    const botModule = await import("../lib/bot");
    const bot = botModule.bot as any;

    const handler = bot._handlers["onNewMention"];

    const mockThread = {
      post: vi.fn(),
      subscribe: vi.fn(),
      isDM: false,
      channel: { id: "group123" },
      id: "group123",
    };
    const mockMessage = {
      text: "plan dinner tomorrow",
      author: { userId: "alice", fullName: "Alice" },
    };

    await handler(mockThread, mockMessage);

    expect(mockThread.subscribe).toHaveBeenCalled();
    expect(mockThread.post).toHaveBeenCalledWith(
      expect.stringContaining("share your location")
    );
  });
});
