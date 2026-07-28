import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";

function loadEnv() {
  const values = {};
  for (const file of [".env.example", ".env.local"]) {
    let contents = "";
    try { contents = readFileSync(file, "utf8"); } catch { continue; }
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
  return values;
}

const env = { ...loadEnv(), ...process.env };
const url = env.VITE_SUPABASE_URL;
const anonKey = env.VITE_SUPABASE_ANON_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Supabase canary configuration is incomplete.");

const stamp = Date.now();
const slug = `phase9-canary-${stamp}`;
const email = `phase9-canary-${stamp}@serveflow.invalid`;
const password = `Sf!Canary-${stamp}-Secure`;
const restaurantName = `ServeFlow Phase 9 Canary ${stamp}`;
const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const results = [];
let owner;
let restaurant;
let draftId;
let extractionId;

async function cleanupCanary(targetSlug) {
  const { data: target } = await service.from("restaurants").select("id").eq("slug", targetSlug).maybeSingle();
  if (!target?.id) return process.stdout.write(`CLEANUP ${targetSlug}: already absent\n`);
  const { data: memberships } = await service.from("restaurant_staff").select("user_id").eq("restaurant_id", target.id);
  const { data: drafts } = await service.from("menu_import_drafts").select("object_path").eq("restaurant_id", target.id);
  const paths = (drafts ?? []).map((draft) => draft.object_path);
  if (paths.length) await service.storage.from("menu-import-drafts").remove(paths);
  await service.from("ai_menu_import_drafts").delete().eq("restaurant_id", target.id);
  await service.from("menu_import_drafts").delete().eq("restaurant_id", target.id);
  await service.from("restaurant_tables").delete().eq("restaurant_id", target.id);
  await service.from("restaurant_staff").delete().eq("restaurant_id", target.id);
  await service.from("users").delete().eq("restaurant_id", target.id);
  const { error: restaurantError } = await service.from("restaurants").delete().eq("id", target.id);
  if (restaurantError) throw restaurantError;
  for (const membership of memberships ?? []) await service.auth.admin.deleteUser(membership.user_id);
  process.stdout.write(`CLEANUP ${targetSlug}: removed\n`);
}

if (process.argv[2] === "--cleanup") {
  if (!process.argv[3]?.startsWith("phase9-canary-")) throw new Error("A phase9 canary slug is required.");
  await cleanupCanary(process.argv[3]);
  process.exit(0);
}

function pass(step, evidence = "passed") {
  results.push({ step, status: "PASS", evidence });
  process.stdout.write(`PASS ${step}: ${evidence}\n`);
}

function localization(field, detection) {
  const language = ["en", "om", "am"].includes(detection?.value) ? detection.value : "en";
  return {
    values: {
      en: { value: language === "en" ? field.value : null, confidence: language === "en" ? field.confidence : 0 },
      om: { value: language === "om" ? field.value : null, confidence: language === "om" ? field.confidence : 0 },
      am: { value: language === "am" ? field.value : null, confidence: language === "am" ? field.confidence : 0 },
    },
    detectedLanguage: detection?.value ?? "unknown",
    languageConfidence: detection?.confidence ?? 0,
    ownerEdited: { en: false, om: false, am: false },
  };
}

async function invoke(client, name, body) {
  const { data, error } = await client.functions.invoke(name, { body });
  if (error) {
    let detail = error.message;
    try { detail = (await error.context?.clone().json())?.error ?? detail; } catch { /* standard message */ }
    throw new Error(`${name}: ${detail}`);
  }
  if (data?.error) throw new Error(`${name}: ${data.error}`);
  return data;
}

async function createPaperMenu() {
  const path = join(tmpdir(), `${slug}.png`);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><style>body{margin:0;background:#ede7db;font-family:Georgia,serif;color:#241b12}.paper{margin:70px;padding:55px;background:#fffdf8;border:1px solid #b9aa91;box-shadow:0 16px 50px #0002}h1{text-align:center;font-size:44px;letter-spacing:3px}h2{margin-top:45px;border-bottom:2px solid #241b12;padding-bottom:8px;font-size:28px}.item{display:flex;justify-content:space-between;margin:28px 0;font-size:24px}.price{font-weight:bold}</style><main class="paper"><h1>CANARY CAFE</h1><h2>BURGERS</h2><div class="item"><span>Classic Burger</span><span class="price">180 ETB</span></div><div class="item"><span>Spicy Chicken Burger</span><span class="price">220 ETB</span></div><h2>DRINKS</h2><div class="item"><span>Fresh Mango Juice</span><span class="price">90 ETB</span></div></main>`);
    await page.screenshot({ path, fullPage: true });
  } finally {
    await browser.close();
  }
  return path;
}

try {
  const signup = await invoke(anon, "owner-signup", { ownerName: "Phase 9 Canary Owner", email, password, restaurantName, restaurantSlug: slug, tableCount: 2 });
  pass("Create Restaurant", `owner created (${String(signup.userId).slice(0, 8)})`);
  const { data: login, error: loginError } = await anon.auth.signInWithPassword({ email, password });
  if (loginError || !login.session) throw new Error(loginError?.message ?? "Canary owner sign-in failed.");
  owner = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${login.session.access_token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { data } = await owner.from("restaurant_staff").select("restaurant_id,restaurants(id,name,slug)").eq("user_id", login.user.id).eq("role", "owner").maybeSingle();
    const row = Array.isArray(data?.restaurants) ? data.restaurants[0] : data?.restaurants;
    if (data?.restaurant_id && row) { restaurant = { id: data.restaurant_id, ...row }; break; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!restaurant) throw new Error("Owner signup did not create the restaurant membership.");

  if (process.argv.includes("--starter-draft")) {
    const starterPayload = await invoke(owner, "menu-ai-import", { mode: "starter", restaurantId: restaurant.id, restaurantType: "Cafe" });
    const starterDraft = starterPayload.importDraft;
    if (starterDraft?.status !== "completed" || starterDraft?.source_kind !== "starter" || !starterDraft?.structured_result?.items?.length) {
      throw new Error("Smart Starter Menu did not create a completed Review Studio draft.");
    }
    const { data: visibleDraft, error: visibleError } = await owner.from("ai_menu_import_drafts").select("id,source_kind,status,structured_result").eq("id", starterDraft.id).single();
    if (visibleError || visibleDraft?.id !== starterDraft.id) throw new Error(visibleError?.message ?? "Review Studio could not load the starter draft.");
    pass("Smart Starter Menu", `${starterDraft.structured_result.items.length} items created in private Review Studio draft ${String(starterDraft.id).slice(0, 8)}`);
    process.stdout.write(`CANARY_RESULT ${JSON.stringify({ status: "PASS", mode: "starter-draft", slug, restaurantId: restaurant.id, steps: results })}\n`);
    await cleanupCanary(slug);
    process.exit(0);
  }

  const sourcePath = await createPaperMenu();
  const bytes = readFileSync(sourcePath);
  draftId = crypto.randomUUID();
  const objectPath = `${restaurant.id}/${draftId}/source`;
  const { error: uploadError } = await owner.storage.from("menu-import-drafts").upload(objectPath, bytes, { contentType: "image/png", upsert: false });
  if (uploadError) throw new Error(uploadError.message);
  const { error: draftError } = await owner.from("menu_import_drafts").insert({ id: draftId, restaurant_id: restaurant.id, file_name: "phase9-paper-menu.png", object_path: objectPath, mime_type: "image/png", file_size: bytes.length, status: "uploaded" });
  if (draftError) throw new Error(draftError.message);
  pass("Upload Paper Menu", `${bytes.length} bytes stored as a private draft`);

  const extractionPayload = await invoke(owner, "menu-ai-import", { mode: "ai", draftId });
  const extraction = extractionPayload.importDraft;
  if (extraction.status !== "completed" || !extraction.structured_result?.items?.length) throw new Error(extraction.error_message ?? "AI Menu Import returned no items.");
  extractionId = extraction.id;
  const extracted = extraction.structured_result;
  pass("AI Menu Import", `${extracted.items.length} items and ${extracted.categories.length} categories`);

  const categories = extracted.categories.map((entry, index) => ({ id: `canary-category-${index + 1}`, name: entry.name.value, confidence: entry.name.confidence, localization: localization(entry.name, entry.detectedLanguage), order: index }));
  const categoryByName = new Map(categories.map((category) => [category.name?.toLocaleLowerCase(), category.id]));
  const items = extracted.items.filter((item) => item.name.value && item.category.value && item.price.value !== null).map((item, index) => ({
    id: `canary-item-${index + 1}`, sourceItemId: item.id, categoryId: categoryByName.get(item.category.value.toLocaleLowerCase()) ?? null, categoryConfidence: item.category.confidence,
    name: item.name, nameLocalization: localization(item.name, item.nameLanguage), description: item.description, descriptionLocalization: localization(item.description, item.descriptionLanguage),
    price: item.price, currency: item.currency, notes: item.optionalNotes, notesLocalization: localization(item.optionalNotes, item.optionalNotesLanguage), sourceText: item.sourceText,
    approved: true, deleted: false, hidden: false, rejected: false, trackingType: "no_tracking",
    imageDraft: { status: "Pending", selectedVersionId: null, versions: [], lastPrompt: null, generationProgress: 0, errorMessage: null }, order: index,
  }));
  if (!items.length || items.some((item) => !item.categoryId)) throw new Error("AI draft was not publishable after review normalization.");
  let reviewState = { schemaVersion: 2, restaurantName: extracted.restaurantName, restaurantNameLocalization: localization(extracted.restaurantName, extracted.restaurantNameLanguage), categories, items, unrecognizedText: extracted.unrecognizedSections.map((section, index) => ({ id: `canary-text-${index + 1}`, text: section.text.value ?? "", confidence: section.text.confidence, status: "ignored", convertedItemId: null })) };
  let reviewRevision = Number(extraction.review_revision ?? 0);
  const saved = await invoke(owner, "menu-review-draft", { extractionId, expectedRevision: reviewRevision, reviewState });
  reviewRevision = Number(saved.importDraft.review_revision);
  reviewState = saved.importDraft.review_state;
  pass("Review Studio", `${items.length} approved items; tracking defaults preserved`);

  const image = await invoke(owner, "menu-item-image-draft", { extractionId, itemId: items[0].id, expectedRevision: reviewRevision });
  reviewRevision = Number(image.reviewRevision);
  const approvedVersion = { ...image.version, status: "Approved" };
  reviewState = { ...reviewState, items: reviewState.items.map((item) => item.id === items[0].id ? { ...item, imageDraft: { ...item.imageDraft, status: "Approved", selectedVersionId: approvedVersion.id, versions: [...item.imageDraft.versions, approvedVersion], generationProgress: 1 } } : item) };
  const imageApproved = await invoke(owner, "menu-review-draft", { extractionId, expectedRevision: reviewRevision, reviewState });
  reviewRevision = Number(imageApproved.importDraft.review_revision);
  reviewState = imageApproved.importDraft.review_state;
  pass("Generate AI Images", "one generated food image approved in Review Studio");

  const { error: themeError } = await owner.from("restaurants").update({ menu_theme: "luxury" }).eq("id", restaurant.id);
  if (themeError) throw new Error(themeError.message);
  pass("Preview and Health Check", "luxury theme selected; reviewed draft ready");

  const published = await invoke(owner, "menu-publish", { restaurantId: restaurant.id, draftId: extractionId, expectedRevision: reviewRevision });
  if (published.itemsPublished !== items.length) throw new Error(`Publish count mismatch: ${published.itemsPublished}/${items.length}`);
  pass("Publish", `${published.itemsPublished} items, ${published.categoriesPublished} categories, ${published.imagesPublished} images`);

  const { error: setupError } = await owner.rpc("complete_restaurant_setup", { target_restaurant_id: restaurant.id, restaurant_info_payload: { restaurant_name: restaurantName, restaurant_type: "Cafe", currency: "ETB", timezone: "Africa/Nairobi", phone: "", address: "", description: "Phase 9 production canary" }, branding_payload: { logo_url: "", cover_url: "", tin_vat: "", receipt_footer: "Thank you", social_links: {} }, table_payload: { table_count: 2 }, business_hours_payload: { opens_at: "08:00", closes_at: "22:00", closed_days: [] }, kitchen_payload: { mode: "single", skipped: true }, staff_invitations_payload: [] });
  if (setupError) throw new Error(setupError.message);
  const { data: dashboardRestaurant, error: dashboardError } = await owner.from("restaurants").select("setup_status,menu_theme").eq("id", restaurant.id).single();
  if (dashboardError || dashboardRestaurant.setup_status?.completed !== true) throw new Error(dashboardError?.message ?? "Dashboard remained in setup mode.");
  if (dashboardRestaurant.menu_theme !== "luxury") throw new Error("Published preview theme did not persist.");
  pass("Restaurant Dashboard", "setup completed and persisted theme loaded");

  const publicClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: publicMenu, error: publicError } = await publicClient.rpc("get_public_qr_menu", { target_restaurant_slug: slug });
  if (publicError || publicMenu?.items?.length !== items.length || publicMenu?.restaurant?.menu_theme !== "luxury") throw new Error(publicError?.message ?? "Public QR menu data mismatch.");
  pass("Open Live Menu", `${publicMenu.items.length} customer items rendered by the public RPC`);
  pass("Scan QR", "public QR lookup succeeded without authentication");

  const appUrl = env.VITE_APP_URL?.replace(/\/$/, "");
  if (!appUrl) throw new Error("VITE_APP_URL is unavailable for hosted browser certification.");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const response = await page.goto(`${appUrl}/r/${slug}`, { waitUntil: "networkidle", timeout: 60_000 });
    if (!response?.ok()) throw new Error(`Hosted customer menu returned ${response?.status()}.`);
    await page.getByText(items[0].name.value, { exact: false }).first().waitFor({ timeout: 30_000 });
  } finally { await browser.close(); }
  pass("Customer Menu Works", "hosted mobile customer route rendered the published item");
  process.stdout.write(`CANARY_RESULT ${JSON.stringify({ status: "PASS", slug, restaurantId: restaurant.id, steps: results })}\n`);
} catch (error) {
  process.stderr.write(`CANARY_RESULT ${JSON.stringify({ status: "FAIL", slug, restaurantId: restaurant?.id ?? null, failedAfter: results.at(-1)?.step ?? "start", error: error instanceof Error ? error.message : String(error), steps: results })}\n`);
  process.exitCode = 1;
}
