import { Chat, Card, Actions, Button } from "chat";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { createMemoryState } from "@chat-adapter/state-memory";
import { generateResponse, generatePreferenceQuestions } from "./ai";
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
  // Clear existing timers
  const existing = timers.get(groupId);
  if (existing) clearTimeout(existing);

  // 30-sec reminder
  const reminderTimer = setTimeout(async () => {
    onReminder();

    // 30-sec timeout after reminder
    const timeoutTimer = setTimeout(() => {
      onTimeout();
    }, 30_000);
    timers.set(groupId, timeoutTimer);
  }, 30_000);

  timers.set(groupId, reminderTimer);
}

async function postMissingReminder(thread: any, session: Session) {
  const missing = getMissingParticipants(session);
  if (missing.length > 0) {
    await thread.post(
      `Still waiting on: ${missing.join(", ")}! Don't leave us hanging! 🎯`
    );
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

  await thread.post("Got everyone's locations! Now let me ask a few quick questions... 🤔");

  try {
    const { questions } = await generatePreferenceQuestions(session.request);
    const updated = { ...session, state: "QUESTION_1" as const, questions };
    sessions.set(groupId, updated);

    // Post ONLY question 1 — next questions post after this one completes
    await postQuestion(thread, updated, 0);
  } catch (error) {
    console.error("[bot] Error generating preference questions:", error);
    await thread.post(
      "Oops, had trouble thinking up questions — let me just search for you!"
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

  // Post question with buttons
  // Using Chat SDK Card with buttons for inline keyboard

  // Post each button as its own row so Telegram doesn't truncate labels
  await thread.post(
    Card({
      title: `❓ ${question.text}\n\nTap all that work for you!`,
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
    // Update state to next question before posting
    const questionState = `QUESTION_${nextIndex + 1}` as const;
    const updated = { ...session, state: questionState as Session["state"] };
    sessions.set(groupId, updated);

    console.log(`[bot] Moving to question ${nextIndex + 1}`);
    await postQuestion(thread, updated, nextIndex);
  } else {
    // All questions done — move to search
    const searching = { ...session, state: "SEARCHING" as const };
    sessions.set(groupId, searching);
    await handleSearchPhase(thread, searching);
  }
}

async function handleSearchPhase(thread: any, session: Session) {
  console.log("[bot] Starting search phase");
  await thread.post("Crunching the data... finding the PERFECT spot for everyone! ✨");

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

Find the top 3 places that match. For each place, include the Google Maps links (directions, photos, reviews).
Also check the weather for the requested time.
Compute routes from each of these starting locations to each place:
${Object.entries(session.locations)
  .map(([userId, loc]) => `- ${userId}: lat ${loc.lat}, lng ${loc.lng}`)
  .join("\n")}

Choose walking if distance < 2km, driving otherwise.`;

  try {
    const response = await generateResponse(prompt);

    // Post response as separate messages (split on place boundaries)
    const parts = response.split(/(?=(?:🥇|🥈|🥉|#[123]|Place [123]|\*\*[123]))/);
    const placeParts = parts.filter((p) => p.trim().length > 0);

    if (placeParts.length >= 3) {
      for (const part of placeParts.slice(0, 3)) {
        await thread.post(part.trim());
      }
    } else {
      // If we can't split cleanly, post the whole response
      await thread.post(response);
    }

    // DM individual routes to each participant
    await handleRouteDMs(thread, session);

    // Post final vote
    await handleFinalVote(thread, session);
  } catch (error) {
    console.error("[bot] Error in search phase:", error);
    await thread.post(
      "Hit a snag searching — try again with a more specific request!"
    );
  }
}

async function handleRouteDMs(thread: any, session: Session) {
  for (const userId of Object.keys(session.locations)) {
    try {
      const dmThread = await bot.openDM(userId);
      await dmThread.post(
        `🗺️ Here are your personal route details for the group's plan: "${session.request}"\n\nCheck the messages in the group for the top picks!`
      );
    } catch {
      console.log(
        `[bot] Could not DM ${userId}, falling back to group message`
      );
      await thread.post(
        `📍 @${userId} — check the suggestions above for your route details!`
      );
    }
  }
}

async function handleFinalVote(thread: any, session: Session) {
  const groupId = session.groupId;
  const updated = { ...session, state: "FINAL_VOTE" as const };
  sessions.set(groupId, updated);


  await thread.post(
    Card({
      title: "🏆 Vote for your favorite!",
      children: [
        Actions([
          Button({ id: "f:0", label: "Place #1", style: "primary" }),
          Button({ id: "f:1", label: "Place #2", style: "primary" }),
          Button({ id: "f:2", label: "Place #3", style: "primary" }),
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

  // Clear timers
  const timer = timers.get(session.groupId);
  if (timer) clearTimeout(timer);
  timers.delete(session.groupId);

  await thread.post(
    `🎉 THE PEOPLE HAVE SPOKEN! Place #${winner + 1} wins!\n\nGo have an AMAZING time! You're gonna love it! 🌟`
  );
}

// === EVENT HANDLERS ===

// Group @mention — start a planning session
bot.onNewMention(async (thread, message) => {
  if (thread.isDM) {
    // 1:1 DM flow — existing behavior
    await thread.subscribe();
    console.log("[bot] DM mention — using direct response flow");
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
      await thread.post("Cleared! Slate is clean — @mention me again whenever you're ready to start fresh. ✨");
    } else {
      await thread.post("Nothing to clear — we're all good! @mention me to start planning.");
    }
    return;
  }

  // Group mention — start planning session
  console.log("[bot] Group mention in", groupId, "— starting planning session");

  const session = createSession(groupId, message.text, [
    message.author.userId,
  ]);
  sessions.set(groupId, session);
  await thread.subscribe();

  await thread.post(
    `Hey everyone! 🎉 Let's plan this together!\n\n**"${message.text}"**\n\nFirst things first — everyone drop your 📍 location so I can find the perfect spot for the whole crew!`
  );

  handleLocationPhase(thread, session);
});

// Subscribed messages — handle locations and follow-ups
bot.onSubscribedMessage(async (thread, message) => {
  if (thread.isDM) {
    // 1:1 DM follow-up
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
        `[bot] Location received from ${userId}: ${loc.latitude}, ${loc.longitude}`
      );

      // Add member if not already tracked
      let updated = session;
      if (!updated.members.includes(userId)) {
        updated = { ...updated, members: [...updated.members, userId] };
      }

      updated = addLocation(updated, userId, loc.latitude, loc.longitude);
      sessions.set(groupId, updated);

      await thread.post(
        `Got ${message.author.fullName}'s location! 📍`
      );

      // Try to advance
      const advanced = advanceState(updated);
      if (advanced.state !== updated.state) {
        sessions.set(groupId, advanced);
        handlePreferencePhase(thread, advanced);
      }
    }
  }
});

// Button actions — handle votes
bot.onAction(async (event) => {
  const buttonId = event.actionId;
  console.log("[bot] Action received:", buttonId);

  const groupId = getGroupId({ id: event.threadId });
  const session = sessions.get(groupId);
  if (!session) {
    // Try to find session by iterating (fallback)
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
    // Preference vote: v:questionIndex:optionIndex
    const parts = buttonId.split(":");
    const questionIndex = parseInt(parts[1], 10);
    const optionIndex = parseInt(parts[2], 10);
    const option = session.questions[questionIndex]?.options[optionIndex] ?? `option-${optionIndex}`;

    // Add to existing votes (multi-select)
    const existingVotes =
      session.votes[questionIndex]?.[userId] ?? [];
    if (!existingVotes.includes(option)) {
      const updated = addVote(session, userId, questionIndex, [
        ...existingVotes,
        option,
      ]);

      // Add member if not tracked
      if (!updated.members.includes(userId)) {
        updated.members = [...updated.members, userId];
      }

      sessions.set(groupId, updated);
      console.log(
        `[bot] Vote from ${userId}: Q${questionIndex} = ${option}`
      );
    }

    // Check if everyone voted — advance
    const current = sessions.get(groupId)!;
    const advanced = advanceState(current);
    if (advanced.state !== current.state) {
      sessions.set(groupId, advanced);

      const completedIndex =
        current.state === "QUESTION_1"
          ? 0
          : current.state === "QUESTION_2"
            ? 1
            : 2;
      if (thread) {
        await handleQuestionAdvance(thread, advanced, completedIndex);
      }
    }
  } else if (buttonId.startsWith("f:")) {
    const placeIndex = parseInt(buttonId.split(":")[1], 10);
    const updated = addFinalVote(session, userId, placeIndex);
    sessions.set(groupId, updated);
    console.log(`[bot] Final vote from ${userId}: Place #${placeIndex + 1}`);

    const advanced = advanceState(updated);
    if (advanced.state === "DONE" && thread) {
      announceWinner(thread, updated);
    }
  }
}
