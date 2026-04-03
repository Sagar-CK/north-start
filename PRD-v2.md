# PRD v2: North Star — Group Planning Bot

## Problem Statement

Planning an outing with friends in a group chat is a mess. Someone suggests dinner, everyone has different preferences, nobody knows where's convenient for everyone, and the conversation goes in circles. There's no tool that facilitates group decision-making with real location intelligence — collecting preferences, finding a spot that works for everyone's taste and commute, and factoring in weather.

## Solution

Evolve the North Star Telegram bot from a 1:1 assistant into a group planning facilitator. When @mentioned in a group chat, the bot runs a structured planning flow:

1. Asks everyone to share their Telegram location
2. Uses Gemini to dynamically generate 3 preference questions based on the request (with multi-select inline keyboard buttons)
3. Collects votes from all group members (with 30-sec reminder pings for stragglers)
4. Searches for the best places using Grounding Lite, factoring in: consensus preferences, optimal location for all participants (meet-in-the-middle), and weather for the requested time
5. Posts 3 place recommendations as separate messages with rich inline URL buttons (directions, photos, reviews)
6. DMs each person their individual route details (falls back to group message if DM fails)
7. Posts a final "Vote for your favorite!" poll so the group picks the winner together

## User Stories

1. As a group member, I want to @mention the bot with a request like "help us plan dinner tomorrow" so that it starts a structured planning flow
2. As a group member, I want the bot to ask me for my location via Telegram's native location sharing so that it can find places convenient for everyone
3. As a group member, I want the bot to remind people who haven't shared their location after 30 seconds so that the flow doesn't stall
4. As a group member, I want the bot to proceed after a second 30-second timeout so that one inactive person doesn't block everyone
5. As a group member, I want the bot to ask me preference questions relevant to my specific request (not hardcoded cuisine lists) so that it works for restaurants, parks, runs, museums, nightlife, or anything
6. As a group member, I want to select multiple options per preference question so that I can express flexibility ("Indian OR Italian both work for me")
7. As a group member, I want the bot to find consensus across everyone's multi-select votes so that the final search reflects what actually overlaps
8. As a group member, I want to see 3 place suggestions posted as separate messages so that I can evaluate each one clearly
9. As a group member, I want each place message to include inline URL buttons for Google Maps directions, photos, and reviews so that I can quickly research the spot
10. As a group member, I want the bot to consider weather when suggesting places so that it doesn't recommend a rooftop bar during a thunderstorm
11. As a group member, I want to receive a DM with my personal route details (distance, duration, walking vs driving) so that I know how to get there from my location
12. As a group member, I want the bot to fall back to posting my route in the group if I haven't started a DM with it so that I still get the info
13. As a group member, I want a final "Vote for your favorite!" poll after seeing all 3 options so that the group can make a collective decision
14. As a group member, I want the bot to announce the winning place so that we have a clear plan
15. As a group member, I want the bot to factor in everyone's locations to find a spot that minimizes total travel time so that nobody has to commute 45 minutes while someone else walks 2 blocks
16. As a group member, I want the preference questions to have 4-6 options each so that there's enough variety without being overwhelming
17. As a group member, I want the bot to work for any type of outing (dinner, coffee, park, museum, run, bar, activity) so that it's not limited to restaurants
18. As a group member, I want the bot to check weather for the specific time we're planning (e.g., tomorrow at 7pm) so that the forecast is relevant
19. As a group member, I want the bot to auto-pick walking vs driving per person based on distance so that route suggestions are practical
20. As a group member, I want the entire flow to feel fun and enthusiastic (not robotic) so that it adds to the group energy

## Implementation Decisions

### Architecture

- **Planning Session Manager** (new deep module) — State machine managing the full group planning lifecycle: location collection → preference questions → voting → search → results → final vote. Tracks participants, locations, votes, timers. Pure logic, no external dependencies. Interface: `createSession()`, `addLocation()`, `addVote()`, `addFinalVote()`, `getSessionState()`, `getConsensus()`.

- **Dynamic Question Generator** (extend AI Client) — New function `generatePreferenceQuestions(request: string)` that asks Gemini to produce 3 questions with 4-6 multi-select options each, returned as structured JSON. Also extend `generateResponse()` to accept preferences + locations as context for the final search.

- **Bot Handlers** (rewrite Bot Instance) — Group-aware handlers: `onNewMention` starts a session, `onAction` handles all button taps (preference votes, final place vote), location message events feed into the session manager. Renders questions as Chat SDK Cards with inline keyboard buttons. Posts results as 3 separate messages with URL buttons. DMs routes with group fallback.

- **Webhook Route** — Likely no changes needed.

### State Machine Flow

```
COLLECTING_LOCATIONS → (timeout logic) → ASKING_PREFERENCES → 
QUESTION_1 → QUESTION_2 → QUESTION_3 → 
SEARCHING → PRESENTING_RESULTS → FINAL_VOTE → DONE
```

### Key Technical Decisions

- **Group member detection**: Auto-detect all members in the group chat via Telegram API
- **Location sharing**: Telegram native location sharing (lat/lng)
- **Preference voting**: Multi-select — users can tap multiple buttons per question, bot tracks all selections
- **Consensus**: Most-tapped options win. Ties broken by Gemini.
- **Reminders**: 30-second ping for non-responders at each step, proceed after another 30 seconds
- **Route DMs**: Attempt DM via Telegram Bot API, fall back to group message on failure
- **Place links**: `googleMapsLinks` from search_places — directionsUrl, photosUrl, reviewsUrl as inline keyboard URL buttons
- **Meet in the middle**: `locationBias` centered at the geographic midpoint of all participant locations, search places within that area, then compute routes from each participant
- **Weather**: Use `lookup_weather` with the specific date/hour from the request (hourly forecast for times within 48hrs, daily beyond that)
- **Dynamic questions**: Gemini generates structured JSON with `{ questions: [{ text, options: string[] }] }`

### Environment Variables

- `GOOGLE_GENERATIVE_AI_API_KEY` — Gemini LLM
- `MAPS_GROUNDING_LITE_API_KEY` — Grounding Lite MCP
- `TELEGRAM_BOT_TOKEN` — Bot token from @BotFather

## Testing Decisions

Good tests verify behavior through public interfaces, not implementation details. Tests should mock external boundaries (MCP, Telegram API, Gemini) but exercise internal logic fully.

### Modules to test

1. **Planning Session Manager** — Heavily tested. Pure state machine with no external deps. Test:
   - Session creation with group members
   - Location addition and geographic midpoint calculation
   - Vote tallying with multi-select (multiple options per user)
   - Consensus calculation (most overlapping picks)
   - Timeout and reminder state transitions
   - Full flow from COLLECTING_LOCATIONS through DONE
   - Prior art: existing tests in `src/__tests__/ai.test.ts` and `src/__tests__/bot.test.ts`

2. **Dynamic Question Generator** — Test:
   - Gemini called with correct prompt for question generation
   - Structured JSON response parsed into valid question objects
   - generateResponse called with preferences + locations context

3. **Bot Handlers** — Not tested (orchestration glue, covered by integration/smoke testing)

## Out of Scope

- Persistent state across server restarts (in-memory only)
- More than one active session per group at a time
- Editing or canceling a session mid-flow
- Supporting private chats (existing 1:1 flow stays as-is)
- Multi-language support
- Image/map rendering in messages (text + links only)
- Production deployment (local + ngrok)

## Further Notes

- The existing 1:1 DM flow (`onNewMention` + `onSubscribedMessage` in private chats) should continue to work alongside the new group flow. The bot should detect whether it's in a group or a DM and behave accordingly.
- Telegram bots can only DM users who have previously sent `/start` to the bot. The DM-with-fallback approach handles this gracefully.
- Grounding Lite rate limits: 100 place queries/min, 300 weather/min, 300 routes/min. A single group session with 4 people = ~1 search + 1 weather + 4 route computations = well within limits.
- The session manager should be extracted as a pure module with zero Telegram/Chat SDK dependencies, making it highly testable and potentially reusable across platforms.
