/** Modelo de IA usado em todas as chamadas ao Lovable AI Gateway. */
export const AI_MODEL = "google/gemini-3-flash";

export const AI_GATEWAY_CHAT_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

/** Acumula o conteúdo textual de uma resposta SSE de /v1/chat/completions. */
export async function readChatStream(response: Response): Promise<string> {
  if (!response.body) throw new Error("Resposta da IA sem corpo.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const event = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
          };
          const choice = event.choices?.[0];
          const chunk = choice?.delta?.content ?? choice?.message?.content;
          if (typeof chunk === "string") text += chunk;
        } catch {
          // ignora fragmentos não-JSON
        }
      }
    }
  }

  return text;
}
