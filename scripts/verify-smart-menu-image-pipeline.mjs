import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1).replace(/^["']|["']$/g, "")];
    }),
);
const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
const service = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const suffix = Date.now().toString(36);
const email = `phase91331-${suffix}@serveflow.test`;
const password = `Sf!${randomUUID()}Aa1`;
const slug = `phase91331-${suffix}`;
let userId = null;
let restaurantId = null;
let browser = null;
const vite = spawn(process.execPath, [
  "node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "4174", "--strictPort",
], { stdio: "ignore", windowsHide: true });

async function waitForApp() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:4174/staff-login");
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Local Vite server did not start.");
}

async function invoke(client, name, body) {
  const { data, error } = await client.functions.invoke(name, { body });
  if (!error) return data;
  let detail = error.message;
  try {
    detail = (await error.context?.clone().json())?.error ?? detail;
  } catch {
    // Retain the standard invocation error.
  }
  throw new Error(`${name}: ${detail}`);
}

try {
  await waitForApp();
  const signup = await invoke(anon, "owner-signup", {
    ownerName: "Phase 9.13.3.1 Owner",
    email,
    password,
    restaurantName: "Phase 9.13.3.1 Image Pipeline",
    restaurantSlug: slug,
    tableCount: 2,
  });
  userId = signup.userId;
  const { data: login, error: loginError } = await anon.auth.signInWithPassword({ email, password });
  if (loginError || !login.session) throw loginError ?? new Error("No owner session was returned.");
  const owner = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${login.session.access_token}` } },
    auth: { persistSession: false },
  });
  const { data: staff, error: staffError } = await owner
    .from("restaurant_staff")
    .select("restaurant_id")
    .eq("user_id", userId)
    .eq("role", "owner")
    .single();
  if (staffError) throw staffError;
  restaurantId = staff.restaurant_id;

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto("http://127.0.0.1:4174/staff-login", { waitUntil: "networkidle" });
  await page.getByLabel("Work email").fill(email);
  await page.locator('input[aria-label="Password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.getByRole("heading", { name: "Restaurant Basics" }).waitFor({ timeout: 30_000 });
  await page.getByLabel("Phone").fill("+251900000000");
  await page.getByLabel("Address").fill("Pipeline verification");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "Choose your restaurant type" }).waitFor();
  await page.getByLabel("Restaurant type").selectOption("Restaurant");
  await page.getByRole("button", { name: "Load Smart Menu" }).click();
  await page.getByRole("heading", { name: "Edit Your Digital Menu" }).waitFor({ timeout: 60_000 });
  await page.locator(".owner-menu-editor").waitFor({ timeout: 60_000 });
  const { data: initialDraft, error: initialDraftError } = await service
    .from("ai_menu_import_drafts")
    .select("structured_result")
    .eq("restaurant_id", restaurantId)
    .eq("source_kind", "smart_library")
    .single();
  if (initialDraftError) throw initialDraftError;
  const generatedItems = initialDraft.structured_result.items.filter((item) =>
    item.smartImage?.versions?.some((version) => version.publicUrl && version.storagePath)
  );
  if (!generatedItems.length) throw new Error("No generated Smart Menu images were found for verification.");
  const results = [];
  const openedCategories = new Set();
  for (const generated of generatedItems) {
    const name = generated.name.value;
    const categoryName = generated.smartImage.category.name || generated.category.value;
    const nameInput = page.locator(`.owner-menu-card input[value="${name}"]`).first();
    if (await nameInput.count() === 0 && categoryName && !openedCategories.has(categoryName)) {
      const categoryToggle = page.locator(".owner-category-toggle").filter({ hasText: categoryName }).first();
      await categoryToggle.click();
      openedCategories.add(categoryName);
    }
    await page.waitForTimeout(100);
    if (await nameInput.count() === 0) {
      throw new Error(`Generated item is not rendered: ${JSON.stringify({ name, categoryName, categories: await page.locator(".owner-category-toggle").allTextContents() })}`);
    }
    await nameInput.scrollIntoViewIfNeeded();
    const card = nameInput.locator("xpath=ancestor::article");
    const image = card.locator(".owner-menu-photo img");
    await image.waitFor({ state: "visible", timeout: 30_000 });
    const decoded = await image.evaluate(async (element) => {
      if (!element.complete) {
        await new Promise((resolve, reject) => {
          element.addEventListener("load", resolve, { once: true });
          element.addEventListener("error", reject, { once: true });
        });
      }
      return {
        src: element.currentSrc,
        complete: element.complete,
        width: element.naturalWidth,
        height: element.naturalHeight,
      };
    });
    const lifecycleElement = card.locator(".owner-image-lifecycle");
    results.push({
      name,
      lifecycle: await lifecycleElement.count()
        ? (await lifecycleElement.textContent())?.trim()
        : null,
      placeholders: await card.locator(".owner-menu-photo > span").count(),
      ...decoded,
    });
  }
  for (const result of results) {
    result.httpStatus = (await fetch(result.src, { method: "HEAD" })).status;
  }
  if (results.some((result) =>
    result.placeholders !== 0 ||
    !result.complete ||
    result.width <= 0 ||
    result.height <= 0 ||
    result.httpStatus !== 200 ||
    !result.src.includes("/smart-menu-images/")
  )) {
    throw new Error(`Review Studio mismatch: ${JSON.stringify(results)}`);
  }

  const firstName = generatedItems[0].name.value;
  const firstInput = page.locator(`.owner-menu-card input[value="${firstName}"]`).first();
  if (await firstInput.count() === 0) {
    const firstCategory = generatedItems[0].smartImage.category.name || generatedItems[0].category.value;
    await page.locator(".owner-category-toggle").filter({ hasText: firstCategory }).first().click();
  }
  const firstCard = firstInput.locator("xpath=ancestor::article");
  await firstCard.locator('input[type="number"]').fill("100");
  await page.waitForTimeout(1_500);
  await page.locator(".owner-save-status").filter({ hasText: "Saved" }).waitFor({ timeout: 30_000 });

  const { data: draft, error: draftError } = await service
    .from("ai_menu_import_drafts")
    .select("structured_result,review_state,review_revision")
    .eq("restaurant_id", restaurantId)
    .eq("source_kind", "smart_library")
    .single();
  if (draftError) throw draftError;
  const hostedGenerated = draft.structured_result.items.filter((item) => item.smartImage?.versions?.length);
  if (
    hostedGenerated.length !== generatedItems.length ||
    hostedGenerated.some((item) =>
      !item.defaultImageReference ||
      !["GENERATING", "PENDING_REVIEW", "APPROVED"].includes(item.smartImage?.status) ||
      !item.smartImage?.restaurantType ||
      !item.smartImage?.category?.id ||
      !item.smartImage?.menuItem?.id ||
      item.smartImage?.versions?.some((version) => !version.publicUrl || !version.thumbnailUrl || !version.storagePath)
    )
  ) {
    throw new Error("Hosted draft did not preserve all generated Smart Image metadata.");
  }
  const savedItem = draft.review_state?.items?.find((item) => item.name?.value === firstName);
  if (
    Number(draft.review_revision) < 1 ||
    !savedItem?.imageDraft?.selectedVersionId ||
    !savedItem?.imageDraft?.versions?.[0]?.storagePath ||
    !savedItem?.imageDraft?.masterImageMetadata?.restaurantType
  ) {
    throw new Error("Review Studio autosave stripped Smart Image metadata.");
  }
  console.log(JSON.stringify({
    restaurantCreated: true,
    hostedGeneratedImages: hostedGenerated.length,
    generatedCategories: [...new Set(hostedGenerated.map((item) => item.smartImage.category.slug))],
    reviewStudioImages: results.length,
    lifecycles: [...new Set(results.map((result) => result.lifecycle))],
    placeholders: results.reduce((total, result) => total + result.placeholders, 0),
    browserDecoded: results.filter((result) => result.complete && result.width > 0 && result.height > 0).length,
    autosaveRevision: draft.review_revision,
    results,
  }, null, 2));
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (userId) await service.auth.admin.deleteUser(userId);
  if (restaurantId) await service.from("restaurants").delete().eq("id", restaurantId);
  const restaurantRemaining = restaurantId
    ? (await service.from("restaurants").select("id", { count: "exact", head: true }).eq("id", restaurantId)).count
    : null;
  console.log(JSON.stringify({ cleanup: { restaurantRemaining, userDeleted: Boolean(userId) } }));
  vite.kill();
}
