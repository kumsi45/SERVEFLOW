import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = resolve(import.meta.dirname, "..");
const env = Object.fromEntries(readFileSync(resolve(root, ".env.local"), "utf8").split(/\r?\n/).filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line)).map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1).replace(/^['\"]|['\"]$/g, "")]; }));
const client = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: versions, error: versionError } = await client.from("ai_menu_publish_versions").select("restaurant_id,draft_id,published_version,published_at,review_snapshot").order("published_at", { ascending: false });
if (versionError) throw versionError;
const latest = [...new Map((versions ?? []).map((version) => [version.restaurant_id, version])).values()];
const restaurantIds = latest.map((version) => version.restaurant_id);
const draftIds = latest.map((version) => version.draft_id);
const [{ data: restaurants, error: restaurantError }, { data: links, error: linkError }, { data: menuItems, error: itemError }, { data: categoryLinks, error: categoryLinkError }] = await Promise.all([
  client.from("restaurants").select("id,name,slug,setup_status").in("id", restaurantIds),
  client.from("ai_menu_publish_item_links").select("draft_id,draft_item_id,menu_item_id").in("draft_id", draftIds),
  client.from("menu_items").select("id,restaurant_id,category_id,name,description,price,image_url,available,archived_at,display_order").in("restaurant_id", restaurantIds),
  client.from("ai_menu_publish_category_links").select("draft_id,draft_category_id,category_id").in("draft_id", draftIds),
]);
if (restaurantError || linkError || itemError || categoryLinkError) throw restaurantError || linkError || itemError || categoryLinkError;

const failures = [];
const urls = new Set();
let activeCount = 0;
for (const publication of latest) {
  const restaurant = restaurants.find((entry) => entry.id === publication.restaurant_id);
  const snapshotItems = (publication.review_snapshot?.items ?? []).filter((item) => item.approved && !item.deleted && !item.hidden && !item.rejected);
  const snapshotCategories = publication.review_snapshot?.categories ?? [];
  const activeCanonicalIds = new Set();
  activeCount += snapshotItems.length;
  for (const snapshot of snapshotItems) {
    const link = links.find((entry) => entry.draft_id === publication.draft_id && entry.draft_item_id === snapshot.id);
    const canonical = link && menuItems.find((entry) => entry.id === link.menu_item_id);
    const categoryLink = categoryLinks.find((entry) => entry.draft_id === publication.draft_id && entry.draft_category_id === snapshot.categoryId);
    const selected = snapshot.imageDraft?.versions?.find((entry) => entry.id === snapshot.imageDraft?.selectedVersionId);
    if (!canonical) { failures.push(`${restaurant?.slug}: missing canonical item for ${snapshot.name?.value}`); continue; }
    activeCanonicalIds.add(canonical.id);
    if (!canonical.available || canonical.archived_at) failures.push(`${restaurant?.slug}: ${canonical.name} is not live`);
    if (canonical.name !== snapshot.name?.value || canonical.description !== (snapshot.description?.value || null) || Number(canonical.price) !== Number(snapshot.price?.value) || canonical.category_id !== categoryLink?.category_id || canonical.display_order !== snapshot.order) failures.push(`${restaurant?.slug}: data mismatch for ${canonical.name}`);
    if (!canonical.image_url) failures.push(`${restaurant?.slug}: missing image for ${canonical.name}`);
    else {
      urls.add(canonical.image_url);
      if (selected?.imageUrl && canonical.image_url !== selected.imageUrl) failures.push(`${restaurant?.slug}: image mapping mismatch for ${canonical.name}`);
    }
  }
  for (const stale of menuItems.filter((item) => item.restaurant_id === publication.restaurant_id && item.available && !item.archived_at && !activeCanonicalIds.has(item.id))) failures.push(`${restaurant?.slug}: stale live item ${stale.name}`);
  if (restaurant?.setup_status?.completed !== true) failures.push(`${restaurant?.slug}: onboarding is not complete`);
  const { data: publicMenu, error } = await client.rpc("get_public_qr_menu", { target_restaurant_slug: restaurant?.slug });
  if (error || !publicMenu) failures.push(`${restaurant?.slug}: public QR RPC failed`);
  else {
    const publicItems = publicMenu.items ?? [];
    const publicCategories = publicMenu.categories ?? [];
    if (publicItems.length !== snapshotItems.length) failures.push(`${restaurant?.slug}: public item count differs`);
    for (const canonicalId of activeCanonicalIds) {
      const canonical = menuItems.find((entry) => entry.id === canonicalId);
      const customer = publicItems.find((entry) => entry.id === canonicalId);
      if (!canonical || !customer) {
        failures.push(`${restaurant?.slug}: public QR item is missing for ${canonical?.name ?? canonicalId}`);
        continue;
      }
      if (customer.name !== canonical.name || customer.description !== canonical.description || Number(customer.price) !== Number(canonical.price) || customer.category_id !== canonical.category_id || customer.image_url !== canonical.image_url || customer.available !== canonical.available) failures.push(`${restaurant?.slug}: public QR data mismatch for ${canonical.name}`);
    }
    const expectedCategoryIds = new Set(categoryLinks.filter((entry) => entry.draft_id === publication.draft_id && snapshotCategories.some((category) => category.id === entry.draft_category_id && !category.deleted)).map((entry) => entry.category_id));
    if (publicCategories.length !== expectedCategoryIds.size || publicCategories.some((category) => !expectedCategoryIds.has(category.id))) failures.push(`${restaurant?.slug}: public category set differs`);
  }
  if (!snapshotCategories.length) failures.push(`${restaurant?.slug}: snapshot has no categories`);
}

let httpFailures = 0;
for (const url of urls) {
  try {
    const response = await fetch(url, { headers: { Range: "bytes=0-31" }, cache: "no-store" });
    if (![200, 206].includes(response.status) || !response.headers.get("content-type")?.startsWith("image/")) httpFailures += 1;
    await response.body?.cancel();
  } catch { httpFailures += 1; }
}
if (httpFailures) failures.push(`${httpFailures} image URLs failed HTTP certification`);

console.log(JSON.stringify({ publishedRestaurants: latest.length, publishedItems: activeCount, uniqueImageUrls: urls.size, httpFailures, failures }, null, 2));
if (failures.length) process.exitCode = 1;
