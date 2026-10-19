// services/whatsapp/client.ts
// A tiny WhatsApp Cloud API client (send a text, mark a message read) with an injectable fetch, so every behaviour is
// tested without the network. It never throws: the caller gets a result object. The token only goes in the Authorization header.

export interface WaSendResult {
  ok: boolean;
  status: number;
  messageId?: string;
  description?: string;
}

export type WaFetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface WhatsAppClient {
  sendText(to: string, text: string): Promise<WaSendResult>;
}

export const MAX_WA_TEXT = 3800; // the platform allows 4096; stay clear of it

export function createWhatsAppClient(
  opts: { accessToken: string; phoneNumberId: string; graphVersion?: string },
  fetchImpl: WaFetchLike = fetch as unknown as WaFetchLike,
  timeoutMs = 8000,
): WhatsAppClient {
  const base = `https://graph.facebook.com/${opts.graphVersion ?? "v21.0"}/${opts.phoneNumberId}`;
  async function post(path: string, payload: Record<string, unknown>): Promise<WaSendResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${base}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.accessToken}` },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      const body = (await res.json().catch(() => null)) as { messages?: { id?: string }[]; error?: { message?: string } } | null;
      if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, messageId: body?.messages?.[0]?.id };
      return { ok: false, status: res.status, description: typeof body?.error?.message === "string" ? body.error.message : undefined };
    } catch {
      return { ok: false, status: 0, description: "network error" };
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    sendText(to, text) {
      return post("messages", { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: text.slice(0, MAX_WA_TEXT) } });
    },
  };
}
