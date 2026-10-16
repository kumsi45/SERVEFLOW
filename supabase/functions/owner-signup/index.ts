// SA2: public signup cannot bypass approval using service-role account creation.
// Existing accounts retain their login/recovery routes.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
Deno.serve((request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return new Response(JSON.stringify({
    error: request.method === "POST"
      ? "New owner registration is unavailable while reviewed applications and invitation delivery are being configured. Existing account holders can sign in."
      : "Method not allowed.",
  }), { status: request.method === "POST" ? 403 : 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
