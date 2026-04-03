# Implementation Issues

Parent PRD: [PRD.md](./PRD.md)

---

## Issue 1: AI Client — Gemini + Grounding Lite MCP connection

**Type**: AFK
**Blocked by**: None — can start immediately

### What to build

Wire up the AI Client module end-to-end: configure Gemini via `@ai-sdk/google`, connect the `@ai-sdk/mcp` client to Google's Grounding Lite MCP server (`https://mapstools.googleapis.com/mcp`) using Streamable HTTP transport with the `X-Goog-Api-Key` header, write the system prompt (fun, enthusiastic OpenClaw personality; top 3 suggestions + weather + route for #1; auto walking/driving), and expose a single `generateResponse(message: string)` function.

### Acceptance criteria

- [ ] Gemini model configured via `@ai-sdk/google` using `GOOGLE_GENERATIVE_AI_API_KEY`
- [ ] MCP client connects to Grounding Lite endpoint with API key header
- [ ] All 3 MCP tools available to Gemini: search places, lookup weather, compute routes
- [ ] System prompt enforces top 3 suggestions, weather, route, and personality
- [ ] `generateResponse()` returns a complete grounded response for a location query
- [ ] Tests verify MCP client initialization with correct endpoint and headers
- [ ] Tests verify Gemini is called with correct system prompt and tools
- [ ] Tests verify response includes places, weather, and route data (mocked MCP tools)

### User stories addressed

- User stories 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 14, 15

---

## Issue 2: Bot Instance — Chat SDK + Telegram adapter

**Type**: AFK
**Blocked by**: Issue 1

### What to build

Create the Chat SDK instance with `@chat-adapter/telegram` and `@chat-adapter/state-memory`. Register an event handler that receives incoming Telegram messages, extracts the text, calls the AI Client's `generateResponse()`, and posts the result back to the thread.

### Acceptance criteria

- [ ] Chat SDK instance created with Telegram adapter and in-memory state
- [ ] Bot token configured via `TELEGRAM_BOT_TOKEN` environment variable
- [ ] Event handler triggers on new messages
- [ ] Handler passes message text to AI Client and posts response back
- [ ] Tests verify handler calls AI Client with correct message text
- [ ] Tests verify AI Client response is posted back to the thread

### User stories addressed

- User stories 1, 10, 11, 12

---

## Issue 3: Webhook Route — Next.js API endpoint

**Type**: AFK
**Blocked by**: Issue 2

### What to build

Create the Next.js API route at `/api/telegram` that receives Telegram webhook POSTs and delegates to the Chat SDK's `bot.webhooks.telegram` handler. This is pure glue code connecting the HTTP layer to the bot.

### Acceptance criteria

- [ ] POST handler at `/api/telegram/route.ts`
- [ ] Delegates request/response to Chat SDK webhook handler
- [ ] Returns appropriate status codes (200 on success)
- [ ] Bot fully initializes on first request

### User stories addressed

- User stories 1, 11

---

## Issue 4: End-to-end smoke test via ngrok + Telegram

**Type**: HITL
**Blocked by**: Issue 3

### What to build

Verify the entire flow works end-to-end: expose the local Next.js dev server via ngrok, set the Telegram bot webhook to the ngrok URL, send real messages from Telegram, and verify the bot responds with place suggestions, weather, and route details. Tune the system prompt based on actual response quality.

### Acceptance criteria

- [ ] ngrok exposes local server with stable URL
- [ ] Telegram webhook set to `https://<ngrok-url>/api/telegram`
- [ ] Bot responds to "find me a place to eat near Union Square" with 3 suggestions
- [ ] Response includes weather details for the area
- [ ] Response includes route details (distance + duration) to top suggestion
- [ ] Bot personality feels fun and enthusiastic
- [ ] Bot handles different query types (parks, coffee, activities, etc.)
- [ ] Bot handles follow-up messages in conversation

### User stories addressed

- All user stories (1-15)
