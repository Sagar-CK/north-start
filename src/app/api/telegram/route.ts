import { bot } from "@/lib/bot";

export async function POST(request: Request): Promise<Response> {
  try {
    const response = await bot.webhooks.telegram(request);
    return response;
  } catch (error) {
    console.error("[webhook] Error:", error);
    return new Response("OK", { status: 200 });
  }
}
