# Implementation Issues

Parent PRD: [PRD-v2.md](./PRD-v2.md)

---

## Issue 1: Planning Session Manager — state machine core

**Type**: AFK
**Blocked by**: None — can start immediately

### What to build

Pure state machine managing the full group planning lifecycle. Tracks participants, their locations (with geographic midpoint calculation), multi-select preference votes, and consensus. Handles state transitions: COLLECTING_LOCATIONS → ASKING_PREFERENCES → QUESTION_1 → QUESTION_2 → QUESTION_3 → SEARCHING → PRESENTING_RESULTS → FINAL_VOTE → DONE. Implements 30-sec reminder and 30-sec timeout logic per step. Zero Telegram or Chat SDK dependencies — pure logic module.

### Acceptance criteria

- [ ] `createSession(groupId, request, members)` initializes a session in COLLECTING_LOCATIONS state
- [ ] `addLocation(userId, lat, lng)` stores location and recalculates geographic midpoint
- [ ] `addVote(userId, questionIndex, options[])` supports multi-select (multiple options per user per question)
- [ ] `getConsensus()` returns most-tapped options across all participants, handles ties
- [ ] `addFinalVote(userId, placeIndex)` tracks final place votes and determines winner
- [ ] `getSessionState()` returns current state, pending participants, and collected data
- [ ] State transitions advance correctly when all members have responded
- [ ] Reminder triggers after 30 seconds of inactivity, identifies non-responders
- [ ] Timeout triggers 30 seconds after reminder, proceeds with available responses
- [ ] Tests cover: session creation, location tracking + midpoint, multi-select voting, consensus calculation, timeout/reminder transitions, full lifecycle

### User stories addressed

- User stories 2, 3, 4, 6, 7, 15

---

## Issue 2: Dynamic Question Generator — Gemini generates preference questions

**Type**: AFK
**Blocked by**: None — can start immediately (parallel with Issue 1)

### What to build

Extend the AI Client with a `generatePreferenceQuestions(request: string)` function. Gemini analyzes the group's request and returns 3 preference questions with 4-6 multi-select options each as structured JSON. Also extend `generateResponse()` to accept preferences and participant locations as additional context for the final place search.

### Acceptance criteria

- [ ] `generatePreferenceQuestions(request)` returns `{ questions: [{ text: string, options: string[] }] }` with exactly 3 questions
- [ ] Questions are contextually relevant (dinner → cuisine/time/vibe, run → time/terrain/distance, museum → type/time/area)
- [ ] Each question has 4-6 options
- [ ] `generateResponse()` accepts optional preferences and locations context
- [ ] Tests verify Gemini called with correct prompt for question generation
- [ ] Tests verify structured JSON response parses into valid question objects

### User stories addressed

- User stories 5, 16, 17

---

## Issue 3: Group location collection flow

**Type**: AFK
**Blocked by**: Issue 1

### What to build

Wire up the bot to handle group @mentions. When @mentioned in a group, the bot creates a planning session, posts a message asking everyone to share their location (Telegram native location sharing), handles incoming location messages, pings non-responders after 30 seconds, and proceeds after a second 30-second timeout. Detect group vs DM context — existing 1:1 flow continues to work in private chats.

### Acceptance criteria

- [ ] Bot detects @mention in a group chat and creates a new planning session
- [ ] Bot posts "Share your location!" message to the group
- [ ] Bot receives Telegram location messages and feeds lat/lng into the session manager
- [ ] Bot pings non-responders by name after 30 seconds: "@name still waiting on you!"
- [ ] Bot proceeds with collected locations after another 30 seconds
- [ ] Existing 1:1 DM flow (`onNewMention` + `onSubscribedMessage`) still works in private chats
- [ ] Bot correctly detects group member count via Telegram API

### User stories addressed

- User stories 1, 2, 3, 4

---

## Issue 4: Preference voting with inline keyboards

**Type**: AFK
**Blocked by**: Issue 1, Issue 2, Issue 3

### What to build

After locations are collected, the bot calls `generatePreferenceQuestions()` to get 3 dynamic questions, then posts them one at a time as Chat SDK Cards with multi-select inline keyboard buttons. Users tap multiple options per question. Bot tracks votes via `onAction` handler, feeds them into the session manager. 30-sec reminder + timeout per question. After all 3 questions, bot calculates consensus.

### Acceptance criteria

- [ ] Bot calls `generatePreferenceQuestions()` with the original group request
- [ ] Each question renders as a Card with inline keyboard buttons (4-6 options)
- [ ] Users can tap multiple buttons per question (multi-select)
- [ ] Bot visually acknowledges each tap (e.g., updates button or posts confirmation)
- [ ] 30-sec reminder pings non-voters, proceeds after another 30 sec
- [ ] After question 3, bot calculates consensus from overlapping multi-select votes
- [ ] Bot transitions to search phase with collected preferences

### User stories addressed

- User stories 5, 6, 7, 16, 17, 20

---

## Issue 5: Search + results with place link buttons

**Type**: AFK
**Blocked by**: Issue 4

### What to build

Take consensus preferences + participant locations, call Grounding Lite to find the best places. Use `search_places` with `locationBias` centered at the geographic midpoint of all participants. Use `lookup_weather` for the requested date/time (hourly if within 48hrs, daily otherwise). Use `compute_routes` from each participant's location to each place. Post 3 separate messages to the group — one per place — each with place name, AI summary, weather, and inline keyboard URL buttons (directions, photos, reviews from `googleMapsLinks`).

### Acceptance criteria

- [ ] `search_places` called with `locationBias` at geographic midpoint of all participants
- [ ] `lookup_weather` called for the specific date/time from the request
- [ ] `compute_routes` called per participant per place (walking if < 2km, driving otherwise)
- [ ] 3 separate messages posted to group, one per place
- [ ] Each message includes: place name, AI summary, weather for requested time
- [ ] Each message has inline keyboard URL buttons: "Directions", "Photos", "Reviews"
- [ ] Weather is factored into place selection (indoor spots for rain, etc.)

### User stories addressed

- User stories 8, 9, 10, 15, 18, 19

---

## Issue 6: DM individual routes with group fallback

**Type**: AFK
**Blocked by**: Issue 5

### What to build

After the 3 place messages are posted, the bot DMs each participant their personal route details for all 3 places: walking vs driving (auto-selected by distance), distance in meters/km, and estimated duration. If the DM fails (user hasn't /started the bot), fall back to posting that person's routes in the group chat.

### Acceptance criteria

- [ ] Bot attempts to DM each participant via Telegram Bot API
- [ ] DM includes route details for all 3 places from that person's location
- [ ] Walking auto-selected for < 2km, driving otherwise
- [ ] If DM fails, bot posts that person's routes in the group chat instead
- [ ] No error or stall if some DMs succeed and others fail

### User stories addressed

- User stories 11, 12, 19

---

## Issue 7: Final group vote

**Type**: AFK
**Blocked by**: Issue 5

### What to build

After the 3 place messages are posted, bot sends a "Vote for your favorite!" message with inline keyboard buttons for Place 1, Place 2, and Place 3. Tallies votes from group members using the session manager's `addFinalVote()`. Once all members have voted (or timeout), announces the winner with an enthusiastic message.

### Acceptance criteria

- [ ] Bot posts "Vote for your favorite!" with 3 place buttons after results
- [ ] Each group member can vote for one place
- [ ] 30-sec reminder + timeout for non-voters
- [ ] Bot announces the winning place with an enthusiastic message
- [ ] Ties broken (most votes wins, random on tie)
- [ ] Session transitions to DONE state

### User stories addressed

- User stories 13, 14, 20

---

## Issue 8: End-to-end smoke test in group chat

**Type**: HITL
**Blocked by**: Issue 6, Issue 7

### What to build

Full end-to-end test in a real Telegram group chat. Add the bot to a group, @mention it with a planning request, verify the entire flow works: location collection → dynamic preference questions → multi-select voting → place results with inline URL buttons → DM routes → final group vote → winner announcement. Tune system prompt and timing based on real usage.

### Acceptance criteria

- [ ] Bot responds to @mention in group chat and starts planning flow
- [ ] Location sharing works via Telegram native feature
- [ ] 30-sec reminders fire for non-responders
- [ ] Preference questions are contextually relevant to the request
- [ ] Multi-select voting works (multiple taps per question)
- [ ] 3 place messages posted with working inline URL buttons (directions, photos, reviews)
- [ ] Individual route DMs sent (or group fallback)
- [ ] Final vote works and winner is announced
- [ ] Existing 1:1 DM flow still works
- [ ] Bot personality feels fun and enthusiastic throughout
