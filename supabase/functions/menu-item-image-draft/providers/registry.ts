import type { ImageGenerationProvider } from "./types.ts";
import { OpenAiImageGenerationProvider } from "./openai.ts";

type ProviderFactory = () => ImageGenerationProvider;

const providers = new Map<string, ProviderFactory>();

export function registerImageGenerationProvider(
  name: string,
  factory: ProviderFactory,
) {
  providers.set(name.trim().toLowerCase(), factory);
}

registerImageGenerationProvider("openai", () =>
  new OpenAiImageGenerationProvider()
);

export function getImageGenerationProvider(): ImageGenerationProvider {
  const providerName =
    Deno.env.get("MENU_IMAGE_PROVIDER")?.trim().toLowerCase() || "openai";
  const factory = providers.get(providerName);
  if (!factory) {
    throw new Error(`Unsupported MENU_IMAGE_PROVIDER: ${providerName}.`);
  }
  return factory();
}
