import { Chat, Card, Actions, Button } from "chat";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { createMemoryState } from "@chat-adapter/state-memory";
import { generateResponse, generatePreferenceQuestions, generatePlacesResponse } from "./ai";
import type { PlacesResponse } from "./ai";
import {
  createSession,
  addLocation,
  addVote,
  addFinalVote,
  advanceState,
  forceAdvance,
  markReminderSent,
  getMissingParticipants,
  getConsensus,
  getWinner,
  type Session,
} from "./session";

export const bot = new Chat({
  userName: "northstar",
  adapters: {
    telegram: createTelegramAdapter({ mode: "webhook" }),
  },
  state: createMemoryState(),
});

// Active planning sessions by group ID
const sessions = new Map<string, Session>();

// Track user display names for @ mentions
const userNames = new Map<string, string>();

// Timer refs for reminders/timeouts
const timers = new Map<string, NodeJS.Timeout>();

function getGroupId(thread: any): string {
  return thread.channel?.id ?? thread.id;
}

function scheduleReminder(
  groupId: string,
  thread: any,
  onReminder: () => void,
  onTimeout: () => void
) {
  const existing = timers.get(groupId);
  if (existing) clearTimeout(existing);

  const reminderTimer = setTimeout(async () => {
    onReminder();

    const timeoutTimer = setTimeout(() => {
      onTimeout();
    }, 8_000);
    timers.set(groupId, timeoutTimer);
  }, 8_000);

  timers.set(groupId, reminderTimer);
}

async function postMissingReminder(thread: any, session: Session) {
  const missing = getMissingParticipants(session);
  if (missing.length > 0) {
    const names = missing.map((id) => userNames.get(id) || id).join(", ");
    await thread.post(`⏳ Still waiting on ${names} -- come on, don't be shy!`);
    sessions.set(session.groupId, markReminderSent(session));
  }
}

async function handleLocationPhase(thread: any, session: Session) {
  const groupId = session.groupId;

  scheduleReminder(
    groupId,
    thread,
    () => {
      const s = sessions.get(groupId);
      if (s && s.state === "COLLECTING_LOCATIONS") {
        postMissingReminder(thread, s);
      }
    },
    () => {
      const s = sessions.get(groupId);
      if (s && s.state === "COLLECTING_LOCATIONS") {
        const advanced = forceAdvance(s);
        sessions.set(groupId, advanced);
        handlePreferencePhase(thread, advanced);
      }
    }
  );
}

async function handlePreferencePhase(thread: any, session: Session) {
  const groupId = session.groupId;
  console.log("[bot] Starting preference phase for", groupId);

  await thread.post("📍 Got everyone's spots! Now let me ask a few quick questions so I can find something perfect for you all...");

  try {
    const { questions } = await generatePreferenceQuestions(session.request);
    const updated = { ...session, state: "QUESTION_1" as const, questions };
    sessions.set(groupId, updated);

    await postQuestion(thread, updated, 0);
  } catch (error) {
    console.error("[bot] Error generating preference questions:", error);
    await thread.post(
      "Hmm, had some trouble there -- let me just search for you directly."
    );
    await handleSearchPhase(thread, session);
  }
}

async function postQuestion(
  thread: any,
  session: Session,
  questionIndex: number
) {
  const question = session.questions[questionIndex];
  if (!question) return;

  const groupId = session.groupId;

  // Post question as markdown, then buttons as a card
  await thread.post({ markdown: `❓ *${question.text}*` });
  await thread.post(
    Card({
      children: question.options.map((opt: string, optIdx: number) =>
        Actions([
          Button({
            id: `v:${questionIndex}:${optIdx}`,
            label: opt,
            style: "primary",
          }),
        ])
      ),
    })
  );

  scheduleReminder(
    groupId,
    thread,
    () => {
      const s = sessions.get(groupId);
      if (s) postMissingReminder(thread, s);
    },
    () => {
      const s = sessions.get(groupId);
      if (s) {
        const advanced = forceAdvance(s);
        sessions.set(groupId, advanced);
        handleQuestionAdvance(thread, advanced, questionIndex);
      }
    }
  );
}

async function handleQuestionAdvance(
  thread: any,
  session: Session,
  completedQuestionIndex: number
) {
  const groupId = session.groupId;
  const nextIndex = completedQuestionIndex + 1;

  if (nextIndex < 3 && nextIndex < session.questions.length) {
    const questionState = `QUESTION_${nextIndex + 1}` as const;
    const updated = { ...session, state: questionState as Session["state"] };
    sessions.set(groupId, updated);

    console.log(`[bot] Moving to question ${nextIndex + 1}`);
    await postQuestion(thread, updated, nextIndex);
  } else {
    const searching = { ...session, state: "SEARCHING" as const };
    sessions.set(groupId, searching);
    await handleSearchPhase(thread, searching);
  }
}

async function handleSearchPhase(thread: any, session: Session) {
  console.log("[bot] Starting search phase");
  await thread.post("Alright, give me a sec -- finding the best spots for you all...");

  const consensus = getConsensus(session);
  const preferenceSummary = consensus
    .map((c) => `${session.questions[c.question]?.text}: ${c.winner}`)
    .join(", ");

  const locationContext = session.midpoint
    ? `Search near lat:${session.midpoint.lat}, lng:${session.midpoint.lng} (midpoint of the group).`
    : "";

  const prompt = `Group request: "${session.request}"
Group preferences: ${preferenceSummary || "no specific preferences"}
${locationContext}

Find the top 3 places that match. For each place, include ALL Google Maps links (directions, photos, reviews, place URL).
Also check the weather for the requested time.
Compute routes from each of these starting locations to each place:
${Object.entries(session.locations)
  .map(([userId, loc]) => `- ${userNames.get(userId) || userId}: lat ${loc.lat}, lng ${loc.lng}`)
  .join("\n")}

Choose walking if distance < 2km, driving otherwise.`;

  try {
    const data = await generatePlacesResponse(prompt);

    // Weather + intro
    await thread.post(`🌤 ${data.weather}\n\n${data.intro}`);

    // Post each place as a beautiful card
    const medals = ["🥇", "🥈", "🥉"];
    for (let i = 0; i < data.places.length && i < 3; i++) {
      const place = data.places[i];
      await postPlaceCard(thread, place, i, medals[i]);
    }

    // Sign-off
    await thread.post(data.signoff);

    // Final vote
    await handleFinalVote(thread, session);
  } catch (error) {
    console.error("[bot] Error in search phase:", error);
    // Fallback to plain text
    try {
      const response = await generateResponse(prompt);
      await thread.post(response);
      await handleFinalVote(thread, session);
    } catch {
      await thread.post("Hit a snag searching -- try @mentioning me again with a more specific request.");
    }
  }
}

async function postPlaceCard(thread: any, place: PlacesResponse["places"][0], index: number, medal: string) {
  // Build the message text as markdown
  let text = `${medal} *Option ${index + 1}: ${place.name}*\n\n`;
  text += `${place.vibe}\n`;
  if (place.rating) {
    text += `\nRating: ${place.rating}`;
  }

  // Route summary
  const routes = place.routes || [];
  if (routes.length > 0) {
    text += `\n\nGetting there:`;
    for (const r of routes) {
      text += `\n  ${r.userName}: ${r.duration} ${r.mode} (${r.distance})`;
    }
  }

  // Add links as markdown
  const links: string[] = [];
  if (place.googleMapsUrl) links.push(`[Open in Maps](${place.googleMapsUrl})`);
  if (place.directionsUrl) links.push(`[Directions](${place.directionsUrl})`);
  if (place.photosUrl) links.push(`[Photos](${place.photosUrl})`);
  if (place.reviewsUrl) links.push(`[Reviews](${place.reviewsUrl})`);

  if (links.length > 0) {
    text += `\n\n${links.join(" | ")}`;
  }

  await thread.post({ markdown: text });
}

async function handleFinalVote(thread: any, session: Session) {
  const groupId = session.groupId;
  const updated = { ...session, state: "FINAL_VOTE" as const };
  sessions.set(groupId, updated);

  await thread.post({ markdown: "🏆 *Alright, time to pick -- vote for your favorite!*" });
  await thread.post(
    Card({
      children: [
        Actions([
          Button({ id: "f:0", label: "Option 1", style: "primary" }),
        ]),
        Actions([
          Button({ id: "f:1", label: "Option 2", style: "primary" }),
        ]),
        Actions([
          Button({ id: "f:2", label: "Option 3", style: "primary" }),
        ]),
      ],
    })
  );

  scheduleReminder(
    groupId,
    thread,
    () => {
      const s = sessions.get(groupId);
      if (s && s.state === "FINAL_VOTE") {
        postMissingReminder(thread, s);
      }
    },
    () => {
      const s = sessions.get(groupId);
      if (s && s.state === "FINAL_VOTE") {
        announceWinner(thread, s);
      }
    }
  );
}

async function announceWinner(thread: any, session: Session) {
  const winner = getWinner(session);
  const updated = { ...session, state: "DONE" as const };
  sessions.set(session.groupId, updated);

  const timer = timers.get(session.groupId);
  if (timer) clearTimeout(timer);
  timers.delete(session.groupId);

  await thread.post(
    `🎉 And the winner is... Option ${winner + 1}! That's a great pick honestly. Go have an incredible time, you all deserve it.`
  );
}

// === EVENT HANDLERS ===

bot.onNewMention(async (thread, message) => {
  // Track user name for @ mentions
  userNames.set(message.author.userId, message.author.fullName);

  if (thread.isDM) {
    await thread.subscribe();
    console.log("[bot] DM mention -- using direct response flow");
    const response = await generateResponse(message.text);
    await thread.post(response);
    return;
  }

  const groupId = getGroupId(thread);

  // Handle /clear command
  if (message.text.includes("/clear")) {
    const existing = sessions.get(groupId);
    if (existing) {
      const timer = timers.get(groupId);
      if (timer) clearTimeout(timer);
      timers.delete(groupId);
      sessions.delete(groupId);
      await thread.post("✨ All cleared! Mention me whenever you're ready to go again.");
    } else {
      await thread.post("Nothing to clear. Mention me to start planning.");
    }
    return;
  }

  // Group mention -- start planning session
  console.log("[bot] Group mention in", groupId);

  const session = createSession(groupId, message.text, [
    message.author.userId,
  ]);
  sessions.set(groupId, session);
  await thread.subscribe();

  await thread.post(
    "Hey hey! 👋 Let's make this happen.\n\nFirst things first -- everyone drop your 📍 location so I can find a spot that works for the whole crew."
  );

  handleLocationPhase(thread, session);
});

bot.onSubscribedMessage(async (thread, message) => {
  // Track user name
  userNames.set(message.author.userId, message.author.fullName);

  if (thread.isDM) {
    const response = await generateResponse(message.text);
    await thread.post(response);
    return;
  }

  const groupId = getGroupId(thread);
  const session = sessions.get(groupId);
  if (!session) return;

  // Check for location in raw Telegram payload
  const raw = (message as any).raw;
  if (raw?.message?.location || raw?.location) {
    const loc = raw?.message?.location ?? raw?.location;
    if (loc?.latitude && loc?.longitude) {
      const userId = message.author.userId;
      console.log(
        `[bot] Location received from ${message.author.fullName}: ${loc.latitude}, ${loc.longitude}`
      );

      let updated = session;
      if (!updated.members.includes(userId)) {
        updated = { ...updated, members: [...updated.members, userId] };
      }

      updated = addLocation(updated, userId, loc.latitude, loc.longitude);
      sessions.set(groupId, updated);

      await thread.post(`📍 Got ${message.author.fullName}'s location!`);
    }
  }
});

bot.onAction(async (event) => {
  const buttonId = event.actionId;
  console.log("[bot] Action received:", buttonId);

  // Track user name
  if (event.user) {
    userNames.set(event.user.userId, event.user.fullName);
  }

  const groupId = getGroupId({ id: event.threadId });
  const session = sessions.get(groupId);
  if (!session) {
    for (const [gid, s] of sessions) {
      if (s.state !== "DONE") {
        handleVoteAction(gid, s, buttonId, event);
        return;
      }
    }
    return;
  }

  handleVoteAction(groupId, session, buttonId, event);
});

async function handleVoteAction(
  groupId: string,
  session: Session,
  buttonId: string,
  event: any
) {
  const userId = event.user?.userId ?? "unknown";
  const thread = event.thread;

  if (buttonId.startsWith("v:")) {
    // Single select -- one pick per person per question
    const parts = buttonId.split(":");
    const questionIndex = parseInt(parts[1], 10);
    const optionIndex = parseInt(parts[2], 10);
    const option = session.questions[questionIndex]?.options[optionIndex] ?? `option-${optionIndex}`;

    let updated = addVote(session, userId, questionIndex, [option]);

    if (!updated.members.includes(userId)) {
      updated = { ...updated, members: [...updated.members, userId] };
    }

    sessions.set(groupId, updated);
    console.log(
      `[bot] Vote from ${userNames.get(userId) || userId}: Q${questionIndex} = ${option}`
    );
  } else if (buttonId.startsWith("f:")) {
    const placeIndex = parseInt(buttonId.split(":")[1], 10);
    const updated = addFinalVote(session, userId, placeIndex);
    sessions.set(groupId, updated);
    console.log(`[bot] Final vote from ${userNames.get(userId) || userId}: Option ${placeIndex + 1}`);
  }
}
