import type {
  GeneratedImage,
  ImageGenerationPrompt,
  ImageGenerationProvider,
} from "./types.ts";

const OPENAI_API_BASE = "https://api.openai.com/v1";

function requireValue(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is not configured.`);
  return normalized;
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function openAiRequest(
  apiKey: string,
  path: string,
  init: RequestInit,
) {
  const response = await fetch(`${OPENAI_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...init.headers,
    },
  });
  if (response.ok) return response;

  let message = `Image provider request failed (${response.status}).`;
  try {
    const payload = await response.json() as {
      error?: { message?: string };
    };
    message = payload.error?.message ?? message;
  } catch {
    // Preserve the safe status-based message when the provider returns no JSON.
  }
  throw new Error(message);
}

export class OpenAiImageGenerationProvider
  implements ImageGenerationProvider {
  readonly name = "openai";
  readonly model: string;
  private readonly apiKey: string;

  constructor() {
    this.apiKey = requireValue(Deno.env.get("OPENAI_API_KEY"), "OPENAI_API_KEY");
    this.model = Deno.env.get("OPENAI_MENU_IMAGE_MODEL")?.trim() ||
      "gpt-image-1";
  }

  async generate(prompt: ImageGenerationPrompt): Promise<GeneratedImage> {
    const response = await openAiRequest(this.apiKey, "/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        prompt: `${prompt.prompt}\nAvoid: ${prompt.negativePrompt}`,
        size: Deno.env.get("OPENAI_MENU_IMAGE_SIZE")?.trim() || "1024x1024",
        quality: Deno.env.get("OPENAI_MENU_IMAGE_QUALITY")?.trim() || "high",
        output_format: "webp",
        output_compression: Number(
          Deno.env.get("OPENAI_MENU_IMAGE_WEBP_COMPRESSION")?.trim() || 90,
        ),
        n: 1,
      }),
    });
    const payload = await response.json() as {
      data?: Array<{ b64_json?: string; id?: string }>;
    };
    const image = payload.data?.[0];
    if (!image?.b64_json) {
      throw new Error("The image provider returned no generated image.");
    }
    return {
      bytes: base64ToBytes(image.b64_json),
      mimeType: "image/webp",
      providerAssetId: image.id ?? null,
    };
  }
}
