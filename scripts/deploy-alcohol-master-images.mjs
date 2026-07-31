import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const env = Object.fromEntries(readFileSync(resolve(root, ".env.local"), "utf8").split(/\r?\n/).filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line)).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).replace(/^['"]|['"]$/g, "")]; }));
if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase deployment credentials are unavailable.");
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const manifest = JSON.parse(readFileSync(resolve(root, "src/modules/setup-wizard/data/masterAlcoholImageLibrary.v1.json"), "utf8"));
if (manifest.phase !== "9.13.11" || manifest.images.length !== 17 || manifest.images.some((entry) => !manifest.categories.includes(entry.category) || entry.lifecycle !== "PENDING_REVIEW" || entry.responsive_variants.length !== 6)) throw new Error("Unexpected Phase 9.13.11 manifest.");

let uploaded = 0;
let skipped = 0;
for (const entry of manifest.images) {
  const { data: image, error: imageError } = await supabase.from("serveflow_smart_menu_images").select("id,base_storage_path,status,current_version").eq("base_storage_path", entry.base_storage_path).single();
  if (imageError) throw imageError;
  const paths = entry.responsive_variants.map((variant) => variant.storage_path);
  const { data: existingVersions, error: existingError } = await supabase.from("serveflow_smart_menu_image_versions").select("id,storage_path,checksum_sha256,status,width,height,mime_type").in("storage_path", paths);
  if (existingError) throw existingError;
  for (const existing of existingVersions) {
    const variant = entry.responsive_variants.find((candidate) => candidate.storage_path === existing.storage_path);
    if (!variant || existing.checksum_sha256 !== variant.checksum_sha256 || existing.status !== "PENDING_REVIEW" || existing.width !== variant.width || existing.height !== variant.height || existing.mime_type !== variant.mime_type) throw new Error(`Existing immutable variant differs for ${entry.dish_name}.`);
  }
  if (existingVersions.length === paths.length) { skipped += 1; continue; }

  const { error: generatingError } = await supabase.from("serveflow_smart_menu_images").update({ status: "GENERATING", provider_key: entry.provider_key, provider_metadata: { specification_id: entry.dish_id, style_guide_id: entry.style_guide_id, style_guide_version: entry.style_guide_version } }).eq("id", image.id);
  if (generatingError) throw generatingError;
  for (const variant of entry.responsive_variants) {
    if (existingVersions.some((existing) => existing.storage_path === variant.storage_path)) continue;
    const bytes = readFileSync(resolve(root, "public/smart-menu-images", variant.storage_path));
    if (createHash("sha256").update(bytes).digest("hex") !== variant.checksum_sha256) throw new Error(`Local checksum changed for ${variant.storage_path}.`);
    const { data: stored } = await supabase.storage.from("smart-menu-images").download(variant.storage_path);
    if (stored) {
      const storedChecksum = createHash("sha256").update(Buffer.from(await stored.arrayBuffer())).digest("hex");
      if (storedChecksum !== variant.checksum_sha256) throw new Error(`Existing Storage object differs for ${entry.dish_name}.`);
    } else {
      const { error: uploadError } = await supabase.storage.from("smart-menu-images").upload(variant.storage_path, bytes, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
      if (uploadError) throw new Error(`${entry.dish_name}: ${uploadError.message}`);
    }
    const record = { smart_image_id: image.id, version: 1, status: "PENDING_REVIEW", storage_path: variant.storage_path, mime_type: variant.mime_type, width: variant.width, height: variant.height, byte_size: variant.byte_size, checksum_sha256: variant.checksum_sha256, provider_key: entry.provider_key, provider_asset_id: `${entry.slug}-v001-${variant.width}w.webp`, provider_metadata: { specification_id: entry.dish_id, style_guide_id: entry.style_guide_id, style_guide_version: entry.style_guide_version, public_url: variant.public_url } };
    const { error: versionError } = await supabase.from("serveflow_smart_menu_image_versions").insert(record);
    if (versionError?.code === "23505") {
      const { data: committed, error: committedError } = await supabase.from("serveflow_smart_menu_image_versions").select("storage_path,checksum_sha256,status,width,height,mime_type").eq("smart_image_id", image.id).eq("version", 1).eq("width", variant.width).eq("mime_type", variant.mime_type).single();
      if (committedError) throw committedError;
      if (committed.storage_path !== variant.storage_path || committed.checksum_sha256 !== variant.checksum_sha256 || committed.status !== "PENDING_REVIEW" || committed.width !== variant.width || committed.height !== variant.height || committed.mime_type !== variant.mime_type) throw new Error(`Existing immutable variant differs for ${entry.dish_name}.`);
    } else if (versionError) throw versionError;
  }
  const { error: pendingError } = await supabase.from("serveflow_smart_menu_images").update({ status: "PENDING_REVIEW", current_version: 1 }).eq("id", image.id);
  if (pendingError) throw pendingError;
  uploaded += 1;
  console.log(`${entry.dish_name}: 6 variants uploaded, PENDING_REVIEW`);
}

const paths = manifest.images.flatMap((entry) => entry.responsive_variants.map((variant) => variant.storage_path));
const { data: verified, error: verifyError } = await supabase.from("serveflow_smart_menu_image_versions").select("storage_path,checksum_sha256,status,width,height,mime_type,smart_image:serveflow_smart_menu_images!inner(base_storage_path,status,current_version)").in("storage_path", paths);
if (verifyError) throw verifyError;
if (verified.length !== paths.length || verified.some((row) => row.status !== "PENDING_REVIEW" || row.smart_image.status !== "PENDING_REVIEW" || row.smart_image.current_version !== 1)) throw new Error("Remote Phase 9.13.11 certification failed.");
console.log(`Deployment complete: ${uploaded} dishes uploaded, ${skipped} dishes skipped, ${verified.length} variants certified.`);
