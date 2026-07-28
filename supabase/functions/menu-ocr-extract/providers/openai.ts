import {
  MENU_EXTRACTION_SCHEMA,
  type ExtractionProvider,
  type ExtractionSource,
  type RawExtractionResult,
} from "../contracts.ts";

const OPENAI_API_BASE = "https://api.openai.com/v1";

const EXTRACTION_INSTRUCTIONS = `
Create a digital menu draft from the supplied restaurant menu.
Extract categories, item names, and prices only when they are visibly present. Never infer or invent those fields.
Do not translate, transliterate, or silently correct source names, categories, prices, or currencies.
Preserve English, Afaan Oromoo, Amharic, and mixed-language source text exactly.
Classify each text field as en, om, am, mixed, or unknown with a separate confidence score.
Language classification must never change or replace the extracted text.
Use null with confidence 0 when a category, item name, price, or currency is absent or uncertain.
Confidence is a number from 0 to 1 for that exact field.
Capture category headings in categories and repeat the applicable category on each item.
Keep numeric price and currency separate. Do not assume a currency from locale.
When an item name is confidently visible and its description is absent, write one natural restaurant-quality description in the same language as the item name. Keep it under 160 characters and at most two short lines. Do not claim ingredients, preparation methods, dietary properties, size, origin, or accompaniments that are not visible in the source. Give generated descriptions confidence 0.5.
When a description is visible, preserve it exactly instead of generating a replacement.
Capture variants, combo-meal status, drink status, and optional notes only when explicit.
sourceText must contain the exact compact source fragment used for each item.
Put every readable fragment that cannot be assigned to a structured field into unrecognizedSections.
Never discard readable text. Preserve duplicates as separate items; duplicate detection is performed later.
`.trim();

function requireValue(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is not configured.`);
  return normalized;
}

function bytesToBase64(bytes: Uint8Array) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
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

  let message = `Extraction provider request failed (${response.status}).`;
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

async function uploadInputFile(
  apiKey: string,
  source: ExtractionSource,
) {
  const form = new FormData();
  form.append("purpose", "user_data");
  form.append(
    "file",
    new Blob([source.bytes], { type: source.mimeType }),
    source.fileName,
  );
  const response = await openAiRequest(apiKey, "/files", {
    method: "POST",
    body: form,
  });
  const payload = await response.json() as { id?: string };
  if (!payload.id) throw new Error("The extraction provider did not accept the source file.");
  return payload.id;
}

function readOutputText(payload: Record<string, unknown>) {
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const entry of output) {
    if (!entry || typeof entry !== "object") continue;
    const content = Array.isArray((entry as Record<string, unknown>).content)
      ? (entry as Record<string, unknown>).content as unknown[]
      : [];
    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        (part as Record<string, unknown>).type === "output_text" &&
        typeof (part as Record<string, unknown>).text === "string"
      ) {
        return (part as Record<string, unknown>).text as string;
      }
    }
  }
  throw new Error("The extraction provider returned no structured output.");
}

export class OpenAiMenuExtractionProvider implements ExtractionProvider {
  readonly name = "openai";
  readonly model: string;
  private readonly apiKey: string;

  constructor() {
    this.apiKey = requireValue(Deno.env.get("OPENAI_API_KEY"), "OPENAI_API_KEY");
    this.model =
      Deno.env.get("OPENAI_MENU_EXTRACTION_MODEL")?.trim() || "gpt-5.6";
  }

  async extract(source: ExtractionSource): Promise<RawExtractionResult> {
    const isImage = source.mimeType.startsWith("image/");
    let uploadedFileId: string | null = null;

    try {
      const sourceContent = isImage
        ? {
            type: "input_image",
            image_url: `data:${source.mimeType};base64,${bytesToBase64(source.bytes)}`,
            detail: "high",
          }
        : {
            type: "input_file",
            file_id: uploadedFileId = await uploadInputFile(this.apiKey, source),
            ...(source.mimeType === "application/pdf" ? { detail: "high" } : {}),
          };

      const response = await openAiRequest(this.apiKey, "/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          store: false,
          input: [{
            role: "user",
            content: [
              { type: "input_text", text: EXTRACTION_INSTRUCTIONS },
              sourceContent,
            ],
          }],
          text: {
            format: {
              type: "json_schema",
              name: "serveflow_menu_extraction",
              strict: true,
              schema: MENU_EXTRACTION_SCHEMA,
            },
          },
        }),
      });
      const payload = await response.json() as Record<string, unknown>;
      return JSON.parse(readOutputText(payload)) as RawExtractionResult;
    } finally {
      if (uploadedFileId) {
        await fetch(`${OPENAI_API_BASE}/files/${uploadedFileId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${this.apiKey}` },
        }).catch(() => undefined);
      }
    }
  }
}
