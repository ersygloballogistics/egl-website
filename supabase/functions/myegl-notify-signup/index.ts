import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const allowed = ["https://www.ersygloballogistics.com", "https://ersygloballogistics.com"];
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const cors = (req: Request) => {
  const o = req.headers.get("origin") || "";
  return { "Content-Type": "application/json", "Access-Control-Allow-Origin": allowed.includes(o) ? o : allowed[0], "Vary": "Origin", "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info", "Access-Control-Allow-Methods": "POST,OPTIONS" };
};

Deno.serve(async req => {
  const headers = cors(req);
  const reply = (status: number, message: string) => new Response(JSON.stringify({ message }), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, "Method not allowed");
  const token = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  if (!token) return reply(401, "Sign in required");
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), key = Deno.env.get("RESEND_API_KEY");
  if (!url || !anon || !service) return reply(503, "Service unavailable");
  const { data: { user }, error } = await createClient(url, anon).auth.getUser(token);
  if (error || !user) return reply(401, "Invalid session");
  if (user.app_metadata?.myegl_role === "admin") return reply(200, "Administrator accounts are not announced");
  const db = createClient(url, service);
  // Claim the notice first so two quick page loads cannot send it twice.
  const { data: claimed } = await db.from("portal_customers").update({ signup_notified_at: new Date().toISOString() }).eq("id", user.id).is("signup_notified_at", null).select("id,email,created_at,customer_number").maybeSingle();
  if (!claimed) return reply(200, "Already announced");
  if (!key) { await db.from("portal_customers").update({ signup_notified_at: null }).eq("id", user.id); return reply(503, "Email service not configured"); }
  const meta = user.user_metadata || {};
  const rows: [string, string][] = [["Name", String(meta.full_name || "")], ["Email", claimed.email], ["Phone", String(meta.phone_contact || "")], ["Customer number", String(claimed.customer_number ?? "")], ["Created", new Date(claimed.created_at).toLocaleString("en-GB", { timeZone: "Asia/Dubai" }) + " (Dubai time)"]];
  const text = ["A new customer has created a MyEGL account.", "", ...rows.map(([k, v]) => k + ": " + (v || "not given")), "", "Review and approve the account in the MyEGL administrator workspace."].join("\n");
  const html = '<h2>New MyEGL customer account</h2><table cellpadding="4">' + rows.map(([k, v]) => "<tr><td><strong>" + esc(k) + "</strong></td><td>" + esc(v || "not given") + "</td></tr>").join("") + "</table><p>Review and approve the account in the MyEGL administrator workspace.</p>";
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify({ from: "ERSY GLOBAL MyEGL <noreply@send.ersygloballogistics.com>", to: ["sales@ersygloballogistics.com"], reply_to: claimed.email, subject: "New MyEGL account: " + claimed.email, text, html }) });
    if (!r.ok) { await db.from("portal_customers").update({ signup_notified_at: null }).eq("id", user.id); return reply(502, "Email was not accepted"); }
  } catch { await db.from("portal_customers").update({ signup_notified_at: null }).eq("id", user.id); return reply(502, "Email could not be sent"); }
  return reply(200, "Sales notified");
});
