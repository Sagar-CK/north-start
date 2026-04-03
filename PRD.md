# PRD: North Start — Telegram Location Guide Bot

## Problem Statement

When someone is in a new area (e.g., Union Square) and wants to find a place to eat, a park, a running track, or any activity nearby, they have to juggle multiple apps — Google Maps for places, a weather app for conditions, and then back to Maps for directions. There's no single conversational interface that gives you recommendations, weather, and route details in one shot.

## Solution

A Telegram bot powered by Gemini and Google's Grounding Lite API that acts as a fun, enthusiastic local guide. A user messages the bot with a natural language request like "find me a place to eat near Union Square" and gets back:

- **Top 3 place suggestions** with AI-generated summaries and Google Maps links
- **Current weather** for the location
- **Route details** (walking or driving, chosen by the AI based on distance) to the top recommendation

The bot has personality — enthusiastic, fun, with soul like OpenClaw. It feels like texting a friend who knows the city.

## User Stories

1. As a Telegram user, I want to message the bot with "find me a place to eat near Union Square" so that I get relevant restaurant suggestions without leaving Telegram
2. As a Telegram user, I want to receive the top 3 suggestions so that I have options to choose from
3. As a Telegram user, I want each suggestion to include a short AI-generated description so that I can quickly decide which one interests me
4. As a Telegram user, I want Google Maps links included with each suggestion so that I can navigate there directly
5. As a Telegram user, I want to see today's weather for the area so that I can plan accordingly (e.g., skip the park if it's raining)
6. As a Telegram user, I want route details to the top suggestion so that I know how far it is and how long it'll take
7. As a Telegram user, I want the bot to automatically choose walking vs driving based on distance so that the route suggestion is practical
8. As a Telegram user, I want to ask for any type of place (restaurants, parks, running tracks, museums, bars, etc.) so that the bot is versatile
9. As a Telegram user, I want to specify any location (not just Union Square) so that the bot works anywhere
10. As a Telegram user, I want the responses to feel fun and enthusiastic so that the experience is enjoyable, not robotic
11. As a Telegram user, I want the bot to respond quickly so that I'm not waiting around on the street
12. As a Telegram user, I want to have a natural conversation so that I can follow up with "what about coffee shops instead?" without restating the location
13. As a Telegram user, I want the bot to handle vague queries like "something fun to do" so that I don't need to be overly specific
14. As a Telegram user, I want weather details to include temperature and conditions so that I can dress appropriately
15. As a Telegram user, I want route distance and estimated duration so that I can decide if it's walkable

## Implementation Decisions

### Architecture

- **Next.js 16 API route** receives Telegram webhook POSTs and delegates to the Chat SDK
- **Chat SDK** (`chat` + `@chat-adapter/telegram` + `@chat-adapter/state-memory`) handles Telegram message parsing, event routing, and response posting
- **AI SDK** (`ai` + `@ai-sdk/google`) calls Gemini as the LLM
- **AI SDK MCP Client** (`@ai-sdk/mcp`) connects to Google's Grounding Lite MCP server at `https://mapstools.googleapis.com/mcp` via Streamable HTTP transport with `X-Goog-Api-Key` header
- **Gemini** autonomously decides which MCP tools to call (search places, lookup weather, compute routes) based on the user's message — no manual orchestration

### Modules

1. **AI Client** — Configures Gemini model, MCP client connection to Grounding Lite, system prompt, and exposes a `generateResponse(message: string)` function. This is the deep module encapsulating all AI complexity.
2. **Bot Instance** — Creates the Chat SDK instance with Telegram adapter and in-memory state. Registers event handlers that pipe messages to the AI Client and post responses back.
3. **Webhook Route** — Next.js API route, pure glue code delegating to Chat SDK's webhook handler.

### Key Technical Decisions

- **LLM**: Gemini via `@ai-sdk/google`, using `GOOGLE_GENERATIVE_AI_API_KEY` for both the model and Grounding Lite MCP
- **State**: In-memory (`@chat-adapter/state-memory`) — no Redis needed, acceptable for a prototype
- **MCP Transport**: Streamable HTTP to `https://mapstools.googleapis.com/mcp`
- **Webhook exposure**: ngrok during development, Vercel in production
- **System prompt**: Instructs Gemini to always return top 3 suggestions + weather + route for #1, choose walking/driving by distance, and respond with a fun enthusiastic personality

### Environment Variables

- `GOOGLE_GENERATIVE_AI_API_KEY` — Used for Gemini LLM and Grounding Lite MCP authentication
- `TELEGRAM_BOT_TOKEN` — Bot token from @BotFather

## Testing Decisions

Good tests verify external behavior through the module's public interface, not implementation details. Tests should mock external boundaries (MCP server, Telegram API) but test the logic within each module end-to-end.

### Modules to test

1. **AI Client** — Test that:
   - MCP client initializes with the correct Grounding Lite endpoint and API key header
   - `generateResponse` calls Gemini with the correct system prompt and MCP tools attached
   - Responses include place suggestions, weather info, and route details (mock MCP tool responses)

2. **Bot Instance** — Test that:
   - Event handler extracts message text and passes it to the AI Client
   - AI Client response gets posted back to the Telegram thread via Chat SDK

### Not tested

- **Webhook Route** — Pure glue code, covered by manual Telegram testing

## Out of Scope

- Persistent state / database — in-memory is fine for this prototype
- Multi-user session management or conversation history across restarts
- Web UI or frontend — the bot is Telegram-only
- Deployment to production (Vercel) — ngrok for now
- Rate limiting or abuse protection
- Multi-language support
- Image/map rendering in responses (text + links only)
- Step-by-step navigation (Grounding Lite doesn't support this)

## Further Notes

- Grounding Lite is currently experimental and free. Rate limits: 100 place queries/min, 300 weather queries/min, 300 route queries/min
- The in-memory state adapter means message history is lost on server restart — acceptable for a 2-hour prototype
- The bot personality should feel like OpenClaw: enthusiastic, warm, with genuine soul — not a corporate assistant
