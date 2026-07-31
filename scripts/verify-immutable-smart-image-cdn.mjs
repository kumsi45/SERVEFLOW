import { chromium } from "playwright";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dataRoot = resolve(root, "src/modules/setup-wizard/data");
const env = Object.fromEntries(readFileSync(resolve(root, ".env.local"), "utf8").split(/\r?\n/).filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line)).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).replace(/^['\"]|['\"]$/g, "")]; }));
const base = `${env.VITE_SUPABASE_URL}/storage/v1/object/public/smart-menu-images`;

const objects = new Map();
for (const name of readdirSync(dataRoot).filter((entry) => /^master.*ImageLibrary\.v1\.json$/.test(entry))) {
  const manifest = JSON.parse(readFileSync(resolve(dataRoot, name), "utf8"));
  for (const image of manifest.images ?? []) for (const variant of image.responsive_variants ?? [image]) objects.set(variant.storage_path, variant.public_url ?? `${base}/${variant.storage_path}`);
}
const upgrade = JSON.parse(readFileSync(resolve(dataRoot, "masterLegacyResponsiveUpgrade.v1.json"), "utf8"));
for (const master of upgrade.masters) for (const variant of master.responsive_variants_added) objects.set(variant.storage_path, variant.public_url ?? `${base}/${variant.storage_path}`);
if (objects.size !== 906) throw new Error(`Expected 906 URLs, found ${objects.size}.`);

let cursor = 0;
const entries = [...objects.entries()];
const failures = [];
await Promise.all(Array.from({ length: 20 }, async () => {
  while (cursor < entries.length) {
    const [path, url] = entries[cursor++];
    let result;
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        result = { status: response.status, cacheControl: response.headers.get("cache-control") ?? "", cfCache: response.headers.get("cf-cache-status") ?? "" };
        await response.body?.cancel();
        if (result.status === 200 && /public/i.test(result.cacheControl) && /max-age=31536000/i.test(result.cacheControl) && /immutable/i.test(result.cacheControl) && result.cfCache === "HIT") break;
      } catch (error) { result = { error: error instanceof Error ? error.message : String(error) }; }
      finally { clearTimeout(timer); }
    }
    if (!result || result.status !== 200 || !/public/i.test(result.cacheControl ?? "") || !/max-age=31536000/i.test(result.cacheControl ?? "") || !/immutable/i.test(result.cacheControl ?? "") || result.cfCache !== "HIT") failures.push({ path, ...result });
  }
}));

const samples = [entries[0][1], entries[Math.floor(entries.length / 2)][1], entries.at(-1)[1]];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const browserResults = [];
for (const url of samples) {
  const result = await page.evaluate(async (imageUrl) => {
    performance.clearResourceTimings();
    const load = () => new Promise((resolveLoad, rejectLoad) => { const image = new Image(); image.onload = () => resolveLoad(true); image.onerror = rejectLoad; image.src = imageUrl; document.body.append(image); });
    await load();
    await load();
    const records = performance.getEntriesByName(imageUrl);
    return { decoded: records.length > 0, browserCacheObserved: records.some((record) => record.transferSize === 0) };
  }, url);
  browserResults.push(result);
}
await browser.close();
if (browserResults.some((result) => !result.decoded || !result.browserCacheObserved)) failures.push({ browserCache: browserResults });

console.log(JSON.stringify({ imagesCertified: entries.length - failures.filter((failure) => failure.path).length, cacheControl: failures.filter((failure) => failure.path && !/immutable/i.test(failure.cacheControl ?? "")).length === 0 ? "906/906 public, max-age=31536000, immutable" : "FAILED", cfCache: failures.filter((failure) => failure.path && failure.cfCache !== "HIT").length === 0 ? "906/906 HIT" : "FAILED", browserCache: browserResults, failures }, null, 2));
if (failures.length) process.exitCode = 1;
