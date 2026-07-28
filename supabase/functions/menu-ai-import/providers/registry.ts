import type { AiMenuProvider } from "../contracts.ts";
import { OpenAiMenuImportProvider } from "./openai.ts";

export function getAiMenuProvider(): AiMenuProvider {
  const provider = Deno.env.get("MENU_AI_PROVIDER")?.trim().toLowerCase()
    || "openai";
  if (provider === "openai") return new OpenAiMenuImportProvider();
  throw new Error(`Unsupported MENU_AI_PROVIDER: ${provider}.`);
}
