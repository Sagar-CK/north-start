import { bot } from "@/lib/bot";

export async function POST(request: Request): Promise<Response> {
  const body = await request.clone().json();
  console.log("[webhook] Incoming Telegram payload:", JSON.stringify(body, null, 2));

  try {
    const response = await bot.webhooks.telegram(request);
    console.log("[webhook] Chat SDK response status:", response.status);
    return response;
  } catch (error) {
    console.error("[webhook] Error handling webhook:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
