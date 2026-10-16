// services/telegram/client.ts
// A tiny Telegram Bot API client (sendMessage only) with an injectable fetch, so every behaviour is tested without
// the network. It never throws: the caller gets a result object. The token is only ever put in the request URL.

export interface SendResult {
  ok: boolean;
  status: number;
  /** Telegram's message_id when ok. */
  messageId?: string;
  /** Seconds to wait when Telegram rate-limits (429). */
  retryAfter?: number;
  /** The bot was blocked / the chat does not exist: the link should be removed. */
  gone: boolean;
  description?: string;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface SendOptions {
  /** Show the link preview card (title, description, image) of the first link. Off by default; used for channel announcements. */
  preview?: boolean;
}

export interface TelegramClient {
  sendMessage(chatId: string, text: string, opts?: SendOptions): Promise<SendResult>;
}

export interface TelegramPhotoClient extends TelegramClient {
  /** A photo (public https URL) with a caption (HTML-escaped here, cut at Telegram's 1024-character limit). */
  sendPhoto(chatId: string, photoUrl: string, caption: string): Promise<SendResult>;
}

export const MAX_MESSAGE_CHARS = 3800;

/** Telegram HTML mode needs only & < > escaped. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function createTelegramClient(token: string, fetchImpl: FetchLike = fetch as unknown as FetchLike, timeoutMs = 5000): TelegramPhotoClient {
  async function post(method: string, payload: Record<string, unknown>): Promise<SendResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: ctrl.signal });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; description?: string; result?: { message_id?: number }; parameters?: { retry_after?: number } } | null;
      const description = typeof body?.description === "string" ? body.description : undefined;
      if (res.status === 200 && body?.ok === true) return { ok: true, status: 200, messageId: body.result?.message_id !== undefined ? String(body.result.message_id) : undefined, gone: false };
      return { ok: false, status: res.status, retryAfter: body?.parameters?.retry_after, gone: res.status === 403, description };
    } catch {
      return { ok: false, status: 0, gone: false, description: "network error" };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    sendPhoto(chatId, photoUrl, caption) {
      return post("sendPhoto", { chat_id: chatId, photo: photoUrl, caption: escapeHtml(caption).slice(0, 1024), parse_mode: "HTML" });
    },
    async sendMessage(chatId, text, opts) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: text.slice(0, MAX_MESSAGE_CHARS), parse_mode: "HTML", disable_web_page_preview: opts?.preview !== true }),
          signal: ctrl.signal,
        });
        const body = (await res.json().catch(() => null)) as { ok?: boolean; description?: string; result?: { message_id?: number }; parameters?: { retry_after?: number } } | null;
        const description = typeof body?.description === "string" ? body.description : undefined;
        const gone = res.status === 403 || (res.status === 400 && /chat not found|user is deactivated|bot was blocked|kicked/i.test(description ?? "")) || /bot was blocked|user is deactivated|kicked from/i.test(description ?? "");
        if (res.status === 200 && body?.ok === true) return { ok: true, status: 200, messageId: body.result?.message_id !== undefined ? String(body.result.message_id) : undefined, gone: false };
        return { ok: false, status: res.status, retryAfter: body?.parameters?.retry_after, gone, description };
      } catch {
        return { ok: false, status: 0, gone: false, description: "network error" };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
