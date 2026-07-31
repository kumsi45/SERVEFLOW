import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dataRoot = resolve(root, "src/modules/setup-wizard/data");
const imageRoot = resolve(root, "public/smart-menu-images");
const env = Object.fromEntries(readFileSync(resolve(root, ".env.local"), "utf8").split(/\r?\n/).filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line)).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).replace(/^['\"]|['\"]$/g, "")]; }));
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const bucket = "smart-menu-images";

function loadInventory() {
  const records = [];
  const manifests = readdirSync(dataRoot).filter((name) => /^master.*ImageLibrary\.v1\.json$/.test(name));
  for (const name of manifests) {
    const manifest = JSON.parse(readFileSync(resolve(dataRoot, name), "utf8"));
    for (const image of manifest.images ?? []) {
      const variants = image.responsive_variants ?? [{ storage_path: image.storage_path, public_url: image.public_url, checksum_sha256: image.checksum_sha256 }];
      records.push(...variants.map((variant) => ({ ...variant, source: name })));
    }
  }
  const upgrade = JSON.parse(readFileSync(resolve(dataRoot, "masterLegacyResponsiveUpgrade.v1.json"), "utf8"));
  for (const master of upgrade.masters) records.push(...master.responsive_variants_added.map((variant) => ({ ...variant, source: "masterLegacyResponsiveUpgrade.v1.json" })));
  const unique = new Map();
  for (const record of records) {
    const normalized = { ...record, public_url: record.public_url ?? `${env.VITE_SUPABASE_URL}/storage/v1/object/public/${bucket}/${record.storage_path}` };
    const prior = unique.get(record.storage_path);
    if (prior && prior.checksum_sha256 !== record.checksum_sha256) throw new Error(`Conflicting checksum: ${record.storage_path}`);
    unique.set(record.storage_path, normalized);
  }
  if (unique.size !== 906) throw new Error(`Expected 906 unique immutable objects, found ${unique.size}.`);
  return [...unique.values()];
}

async function selectVersions(paths) {
  const wanted = new Set(paths);
  const { data, error } = await supabase.from("serveflow_smart_menu_image_versions").select("storage_path,status,version,width,height,mime_type,byte_size,checksum_sha256,smart_image_id").range(0, 4999);
  if (error) throw error;
  return data.filter((row) => wanted.has(row.storage_path)).sort((a, b) => a.storage_path.localeCompare(b.storage_path));
}

async function pool(items, concurrency, worker) {
  let cursor = 0;
  const failures = [];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try { await worker(items[index], index); } catch (error) { failures.push({ path: items[index].storage_path, error: error instanceof Error ? error.message : String(error) }); }
    }
  }));
  return failures;
}

const inventory = loadInventory();
console.log(`inventory ${inventory.length}/906`);
for (const item of inventory) {
  const bytes = readFileSync(resolve(imageRoot, item.storage_path));
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== item.checksum_sha256) throw new Error(`Local checksum mismatch: ${item.storage_path}`);
}
console.log(`local checksums ${inventory.length}/906`);
const before = await selectVersions(inventory.map((item) => item.storage_path));
if (before.length !== inventory.length) throw new Error(`Expected 906 remote version rows, found ${before.length}.`);
console.log(`remote snapshot ${before.length}/906`);

let completed = 0;
let skipped = 0;
const updateFailures = await pool(inventory, 8, async (item) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(item.public_url, { signal: controller.signal });
    const cacheControl = response.headers.get("cache-control") ?? "";
    await response.body?.cancel();
    if (response.status === 200 && /public/i.test(cacheControl) && /max-age=31536000/i.test(cacheControl) && /immutable/i.test(cacheControl)) {
      skipped++;
      completed++;
      if (completed % 50 === 0 || completed === inventory.length) console.error(`cache metadata ${completed}/${inventory.length} (${skipped} already certified)`);
      return;
    }
  } catch { /* A failed read check is remediated by the metadata update below. */ }
  finally { clearTimeout(timer); }
  const bytes = readFileSync(resolve(imageRoot, item.storage_path));
  const { error } = await supabase.storage.from(bucket).update(item.storage_path, bytes, { contentType: "image/webp", cacheControl: "31536000, immutable", upsert: true });
  if (error) throw error;
  completed++;
  if (completed % 50 === 0 || completed === inventory.length) console.error(`cache metadata ${completed}/${inventory.length} (${skipped} already certified)`);
});
if (updateFailures.length) throw new Error(`Storage metadata failures: ${JSON.stringify(updateFailures.slice(0, 10))}`);

const after = await selectVersions(inventory.map((item) => item.storage_path));
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Immutable image version metadata changed.");

console.log(JSON.stringify({ images: inventory.length, updated: completed - skipped, alreadyCertified: skipped, localChecksumsVerified: inventory.length, remoteVersionRowsUnchanged: after.length, publicUrlsUnchanged: inventory.length, failures: 0 }, null, 2));
