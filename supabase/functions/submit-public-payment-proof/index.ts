import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const form = await request.formData();
    const restaurantSlug = String(form.get("restaurantSlug") ?? "").trim();
    const tableNumber = String(form.get("tableNumber") ?? "").trim();
    const qrToken = String(form.get("qrToken") ?? "").trim();
    const browserSessionToken = String(form.get("browserSessionToken") ?? "").trim();
    const invoiceId = String(form.get("invoiceId") ?? "").trim();
    const referenceNumber = String(form.get("referenceNumber") ?? "").trim().slice(0, 120) || null;
    const screenshot = form.get("screenshot");
    if (!restaurantSlug || !tableNumber || !qrToken || !invoiceId) return json({ error: "Payment session is incomplete." }, 400);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const client = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: session, error: sessionError } = await client.rpc("get_public_qr_order_session", {
      target_restaurant_slug: restaurantSlug, table_number: tableNumber, qr_token: qrToken, browser_session_token: browserSessionToken,
    });
    if (sessionError || !session || !Array.isArray(session.invoices) || !session.invoices.some((invoice: { id?: string }) => invoice.id === invoiceId)) return json({ error: "Payment session could not be verified." }, 403);

    const { data: invoice, error: invoiceError } = await client.from("order_invoices").select("id,restaurant_id,status").eq("id", invoiceId).single();
    if (invoiceError || !invoice || !["pending", "paid"].includes(invoice.status)) return json({ error: "Invoice is not available for payment evidence." }, 409);
    let screenshotPath: string | null = null;
    if (screenshot instanceof File && screenshot.size > 0) {
      if (screenshot.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(screenshot.type)) return json({ error: "Screenshot must be JPG, PNG or WebP and under 5 MB." }, 400);
      const extension = screenshot.type === "image/png" ? "png" : screenshot.type === "image/webp" ? "webp" : "jpg";
      screenshotPath = `${invoice.restaurant_id}/${invoice.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await client.storage.from("payment-screenshots").upload(screenshotPath, screenshot, { contentType: screenshot.type, upsert: false });
      if (uploadError) return json({ error: "Payment screenshot could not be stored." }, 500);
    }
    const { error: updateError } = await client.from("order_invoices").update({ reference_number: referenceNumber, screenshot_url: screenshotPath }).eq("id", invoice.id).eq("restaurant_id", invoice.restaurant_id);
    if (updateError) { if (screenshotPath) await client.storage.from("payment-screenshots").remove([screenshotPath]); return json({ error: "Payment evidence could not be submitted." }, 500); }
    return json({ submitted: true });
  } catch { return json({ error: "Payment evidence could not be submitted." }, 500); }
});
