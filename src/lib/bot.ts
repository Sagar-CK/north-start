import { Chat } from "chat";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { createMemoryState } from "@chat-adapter/state-memory";
import { generateResponse } from "./ai";

export const bot = new Chat({
  userName: "northstar",
  adapters: {
    telegram: createTelegramAdapter(),
  },
  state: createMemoryState(),
});

// DMs to a Telegram bot fire as mentions
bot.onNewMention(async (thread, message) => {
  console.log("[bot] onNewMention fired — text:", message.text, "threadId:", thread.id);
  await thread.subscribe();
  try {
    const response = await generateResponse(message.text);
    console.log("[bot] AI response received, length:", response.length);
    await thread.post(response);
    console.log("[bot] Reply posted to thread");
  } catch (error) {
    console.error("[bot] Error in onNewMention handler:", error);
  }
});

// Follow-up messages in subscribed threads
bot.onSubscribedMessage(async (thread, message) => {
  console.log("[bot] onSubscribedMessage fired — text:", message.text, "threadId:", thread.id);
  try {
    const response = await generateResponse(message.text);
    console.log("[bot] AI response received, length:", response.length);
    await thread.post(response);
    console.log("[bot] Reply posted to thread");
  } catch (error) {
    console.error("[bot] Error in onSubscribedMessage handler:", error);
  }
});
