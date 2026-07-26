import type { ExtractionProvider } from "../contracts.ts";
import { OpenAiMenuExtractionProvider } from "./openai.ts";

export function getMenuExtractionProvider(): ExtractionProvider {
  const provider = Deno.env.get("MENU_OCR_PROVIDER")?.trim().toLowerCase()
    || "openai";
  if (provider === "openai") return new OpenAiMenuExtractionProvider();
  throw new Error(`Unsupported MENU_OCR_PROVIDER: ${provider}.`);
}
