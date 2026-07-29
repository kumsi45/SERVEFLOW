import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const env = Object.fromEntries(readFileSync(resolve(root, ".env.local"), "utf8").split(/\r?\n/).filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line)).map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")]; }));
const url = env.VITE_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Supabase deployment credentials are unavailable.");
const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const manifest = JSON.parse(readFileSync(resolve(root, "src/modules/setup-wizard/data/masterBreakfastImageLibrary.v1.json"), "utf8"));
if (manifest.images.length !== 8 || manifest.images.some((entry) => entry.status !== "PENDING_REVIEW")) throw new Error("Breakfast manifest is not ready for pending review deployment.");

const { data: library, error: libraryError } = await supabase.from("serveflow_smart_menu_libraries").select("id").eq("restaurant_type", "Restaurant").single();
if (libraryError) throw new Error(libraryError.message);
const names = manifest.images.map((entry) => entry.item_name);
const { data: items, error: itemError } = await supabase.from("serveflow_master_menu_items").select("id,name").in("name", names);
if (itemError) throw new Error(itemError.message);
if (items.length !== 8) throw new Error(`Expected 8 canonical breakfast items, found ${items.length}.`);
const itemByName = new Map(items.map((item) => [item.name, item.id]));
const { data: images, error: imageError } = await supabase.from("serveflow_smart_menu_images").select("id,item_id,base_storage_path,status,current_version").eq("library_id", library.id).in("item_id", items.map((item) => item.id));
if (imageError) throw new Error(imageError.message);
if (images.length !== 8) throw new Error(`Expected 8 master image identities, found ${images.length}.`);
const imageByItem = new Map(images.map((image) => [image.item_id, image]));

for (const entry of manifest.images) {
  const itemId = itemByName.get(entry.item_name);
  const image = imageByItem.get(itemId);
  if (!itemId || !image) throw new Error(`Missing master identity for ${entry.item_name}.`);
  if (image.base_storage_path !== `restaurant/breakfast/${entry.slug}`) throw new Error(`Unexpected deterministic path for ${entry.item_name}.`);
  const { error: generatingError } = await supabase.from("serveflow_smart_menu_images").update({ status: "GENERATING", provider_key: entry.provider_key, provider_metadata: { specification_id: entry.specification_id, style_guide_id: entry.style_guide_id, style_guide_version: entry.style_guide_version } }).eq("id", image.id);
  if (generatingError) throw new Error(generatingError.message);

  const { data: existing, error: existingError } = await supabase.from("serveflow_smart_menu_image_versions").select("id,checksum_sha256,status").eq("storage_path", entry.storage_path).maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) {
    if (existing.checksum_sha256 !== entry.checksum_sha256 || existing.status !== "PENDING_REVIEW") throw new Error(`Existing immutable version differs for ${entry.item_name}.`);
  } else {
    const bytes = readFileSync(resolve(root, "public/smart-menu-images", entry.storage_path));
    const { error: uploadError } = await supabase.storage.from("smart-menu-images").upload(entry.storage_path, bytes, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
    if (uploadError) throw new Error(`${entry.item_name}: ${uploadError.message}`);
    const { error: versionError } = await supabase.from("serveflow_smart_menu_image_versions").insert({ smart_image_id: image.id, version: 1, status: "PENDING_REVIEW", storage_path: entry.storage_path, mime_type: "image/webp", width: 2048, height: 2048, byte_size: entry.byte_size, checksum_sha256: entry.checksum_sha256, provider_key: entry.provider_key, provider_asset_id: entry.filename, provider_metadata: { specification_id: entry.specification_id, style_guide_id: entry.style_guide_id, style_guide_version: entry.style_guide_version } });
    if (versionError) throw new Error(versionError.message);
  }
  const { error: pendingError } = await supabase.from("serveflow_smart_menu_images").update({ status: "PENDING_REVIEW", current_version: 1 }).eq("id", image.id);
  if (pendingError) throw new Error(pendingError.message);
  console.log(`${entry.item_name}: PENDING_REVIEW`);
}

const { data: verified, error: verifyError } = await supabase.from("serveflow_smart_menu_image_versions").select("storage_path,status,checksum_sha256,smart_image:serveflow_smart_menu_images!inner(library_id,item_id,status,current_version)").eq("smart_image.library_id", library.id).in("storage_path", manifest.images.map((entry) => entry.storage_path));
if (verifyError) throw new Error(verifyError.message);
if (verified.length !== 8 || verified.some((entry) => entry.status !== "PENDING_REVIEW" || entry.smart_image.status !== "PENDING_REVIEW" || entry.smart_image.current_version !== 1)) throw new Error("Remote breakfast image certification failed.");
console.log("Remote certification: 8 unique breakfast masters are PENDING_REVIEW.");
