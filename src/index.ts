const DEFAULT_MODEL = "@cf/mistral/mistral-7b-instruct-v0.2";
const DEFAULT_SYSTEM_PROMPT =
  "You are a goofy but helpful Flarum AI assistant. Reply in a casual internet style with light slang like 'lol' and 'no cap' when it fits, but keep it clear, friendly, and useful for a forum audience.";

type Message = {
  role: string;
  content: string;
};

type Env = {
  AI: {
    run: (model: string, input: Record<string, unknown>) => Promise<unknown>;
  };
  FLARUM_API_URL?: string;
  FLARUM_URL?: string;
  FLARUM_API_TOKEN?: string;
  FLARUM_TOKEN?: string;
  API_TOKEN?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return undefined;
}

function coerceString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readFirstString(obj: Record<string, unknown> | undefined, keys: string[]): string {
  if (!obj) {
    return "";
  }

  for (const key of keys) {
    const text = coerceString(obj[key]);
    if (text) {
      return text;
    }
  }

  return "";
}

function normaliseMessages(payload: Record<string, unknown> | undefined): Message[] {
  const record = asRecord(payload);
  if (!record) {
    return [];
  }

  const rawMessages = record.messages;
  if (Array.isArray(rawMessages)) {
    return rawMessages
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
      .map((message) => {
        const role = coerceString(message.role);
        const content = coerceString(message.content);

        if (!role || !content) {
          return null;
        }

        return { role, content };
      })
      .filter((message): message is Message => message !== null);
  }

  const promptText = readFirstString(record, [
    "message",
    "prompt",
    "text",
    "content",
    "body",
    "comment",
  ]);

  if (promptText) {
    return [{ role: "user", content: promptText }];
  }

  const data = asRecord(record.data);
  if (data) {
    const nestedText = readFirstString(data, ["message", "prompt", "text", "content", "body"]);
    if (nestedText) {
      return [{ role: "user", content: nestedText }];
    }
  }

  return [];
}

function withPersonality(messages: Message[]): Message[] {
  if (!messages.length) {
    return messages;
  }

  const hasSystemMessage = messages.some((message) => message.role === "system");
  if (hasSystemMessage) {
    return messages;
  }

  return [{ role: "system", content: DEFAULT_SYSTEM_PROMPT }, ...messages];
}

function getDiscussionId(payload: Record<string, unknown> | undefined): string | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  const directId = readFirstString(record, ["discussionId", "discussion_id", "discussionIdRaw"]);
  if (directId) {
    return directId;
  }

  const data = asRecord(record.data);
  const relationships = asRecord(data?.relationships);
  const discussionContainer = asRecord(relationships?.discussion);
  const nestedDiscussion = asRecord(record.discussion) ?? asRecord(data?.discussion) ?? asRecord(discussionContainer?.data);

  if (nestedDiscussion) {
    const nestedId = readFirstString(nestedDiscussion, ["id", "discussionId", "discussion_id"]);
    if (nestedId) {
      return nestedId;
    }
  }

  const attributes = asRecord(data?.attributes);
  if (attributes?.discussionId) {
    return String(attributes.discussionId);
  }

  return null;
}

function extractReply(response: unknown): string {
  if (!response) {
    return "";
  }

  if (typeof response === "string") {
    return response;
  }

  const record = asRecord(response);
  if (!record) {
    return JSON.stringify(response);
  }

  if (typeof record.response === "string") {
    return record.response;
  }

  if (typeof record.result === "string") {
    return record.result;
  }

  if (Array.isArray(record.output)) {
    return record.output
      .map((item) => {
        const itemRecord = asRecord(item);
        if (itemRecord) {
          return coerceString(itemRecord.text ?? itemRecord.content);
        }

        return coerceString(item);
      })
      .join("\n");
  }

  const outputRecord = asRecord(record.output);
  if (outputRecord) {
    return coerceString(outputRecord.text ?? outputRecord.content);
  }

  return JSON.stringify(response);
}

async function postReplyToFlarum(
  env: Env,
  discussionId: string,
  content: string,
): Promise<{ ok: boolean; status?: number; reason?: string; url?: string; body?: unknown; error?: string }> {
  const apiUrl = coerceString(env.FLARUM_API_URL || env.FLARUM_URL);
  const token = coerceString(env.FLARUM_API_TOKEN || env.FLARUM_TOKEN || env.API_TOKEN);

  if (!apiUrl || !token || !discussionId || !content) {
    return {
      ok: false,
      reason: "Missing Flarum API config or discussion ID.",
    };
  }

  const url = `${apiUrl.replace(/\/+$/, "")}/api/discussions/${encodeURIComponent(discussionId)}/posts`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${token}`,
      },
      body: JSON.stringify({
        data: {
          type: "posts",
          attributes: {
            content,
          },
          relationships: {
            discussion: {
              data: {
                type: "discussions",
                id: String(discussionId),
              },
            },
          },
        },
      }),
    });

    const text = await response.text();
    let body: unknown;

    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }

    return {
      ok: response.ok,
      status: response.status,
      url,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "Flarum post request failed.",
      error: String(error),
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "MistralBot_Flarum" });
    }

    if (request.method !== "POST") {
      return Response.json(
        { ok: false, error: "Only POST requests are supported." },
        { status: 405 },
      );
    }

    if (!env.AI) {
      return Response.json(
        {
          ok: false,
          error:
            "The Cloudflare AI binding is missing. Add an [ai] binding named AI to wrangler.toml or your Worker environment.",
        },
        { status: 500 },
      );
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return Response.json(
        { ok: false, error: "Request body must be valid JSON." },
        { status: 400 },
      );
    }

    const requestRecord = asRecord(payload);
    const promptText = requestRecord ? readFirstString(requestRecord, [
      "message",
      "prompt",
      "text",
      "content",
      "body",
      "comment",
      "description",
    ]) : "";

    let finalPayload = requestRecord;
    if (!promptText && requestRecord) {
      const data = asRecord(requestRecord.data);
      if (data) {
        const nestedPrompt = readFirstString(data, [
          "message",
          "prompt",
          "text",
          "content",
          "body",
          "comment",
          "description",
        ]);

        if (nestedPrompt) {
          finalPayload = { ...requestRecord, message: nestedPrompt };
        }
      }
    }

    const messages = withPersonality(normaliseMessages(finalPayload));

    if (!messages.length) {
      return Response.json(
        { ok: false, error: "Provide a message, prompt, or Flarum discussion payload." },
        { status: 400 },
      );
    }

    const maxTokens = Number(asRecord(finalPayload)?.max_tokens ?? 256);
    const temperature = Number(asRecord(finalPayload)?.temperature ?? 0.7);

    const aiResponse = await env.AI.run(DEFAULT_MODEL, {
      messages,
      max_tokens: Number.isFinite(maxTokens) ? maxTokens : 256,
      temperature: Number.isFinite(temperature) ? temperature : 0.7,
    });

    const reply = extractReply(aiResponse).trim();
    const discussionId = getDiscussionId(finalPayload);

    let flarumResult: { ok: boolean; status?: number; reason?: string; url?: string; body?: unknown; error?: string } | null = null;
    if (discussionId) {
      flarumResult = await postReplyToFlarum(env, discussionId, reply);
    }

    return Response.json({
      ok: true,
      bot: "MistralBot_Flarum",
      model: DEFAULT_MODEL,
      reply,
      discussionId,
      flarum: flarumResult,
    });
  },
};
