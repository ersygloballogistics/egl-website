import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const site = "https://www.ersygloballogistics.com";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const enc = encodeURIComponent;
const LINKS: Record<string, (n: string) => string> = {
  dhl: n => "https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=" + enc(n),
  fedex: n => "https://www.fedex.com/fedextrack/?trknbr=" + enc(n),
  ups: n => "https://www.ups.com/track?loc=en_US&tracknum=" + enc(n),
  aramex: n => "https://www.aramex.com/track/results?ShipmentNumber=" + enc(n),
  usps: n => "https://tools.usps.com/go/TrackConfirmAction?tLabels=" + enc(n),
};
const LABELS: Record<string, string> = { dhl: "DHL", fedex: "FedEx", ups: "UPS", aramex: "Aramex", usps: "USPS" };
const carrierKey = (c: unknown) => String(c || "").toLowerCase().replace(/[^a-z]/g, "");
const trackingUrl = (carrier: unknown, number: unknown) => { const n = String(number || "").replace(/\s+/g, ""); if (!/^[A-Za-z0-9-]{4,40}$/.test(n)) return ""; const f = LINKS[carrierKey(carrier)]; return f ? f(n) : ""; };

// Customer-facing wording for each shipment stage. "not_started" is never emailed.
const STAGES: Record<string, { title: string; body: string }> = {
  preparing: { title: "We are preparing your shipment", body: "Our team has started preparing your order." },
  booked: { title: "Your shipment is booked", body: "Your shipment has been booked with the carrier." },
  in_transit: { title: "Your shipment is in transit", body: "Your shipment is on its way." },
  customs_clearance: { title: "Your shipment is in customs clearance", body: "Your shipment is going through customs clearance. We will update you when it is released." },
  out_for_delivery: { title: "Your shipment is out for delivery", body: "Your shipment is out for delivery and should reach you soon." },
  delivered: { title: "Your shipment has been delivered", body: "Your shipment has been delivered. Thank you for choosing ERSY GLOBAL." },
};

export function buildStatusEmail(job: any) {
  const stage = STAGES[job.shipment_status];
  const ref = String(job.reference || "");
  const link = trackingUrl(job.tracking_carrier, job.tracking_number);
  const carrier = LABELS[carrierKey(job.tracking_carrier)] || "";
  const rows: [string, string][] = [["Order", ref], ["Status", stage.title.replace(/^(Your shipment is |Your shipment has been |We are )/, "").replace(/^./, c => c.toUpperCase())]];
  if (job.tracking_number) rows.push(["Tracking", (carrier ? carrier + " " : "") + job.tracking_number]);
  if (job.estimated_transit_date && job.shipment_status !== "delivered") rows.push(["Estimated delivery", String(job.estimated_transit_date)]);
  const text = [stage.title + ".", "", stage.body, "", ...rows.map(([k, v]) => k + ": " + v), link ? "Track your shipment: " + link : "", "View your order in MyEGL: " + site + "/myegl/", "", "ERSY GLOBAL"].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
  const row = (k: string, v: string) => '<tr><td style="padding:5px 0;color:#5b6f7f;font-size:12px;letter-spacing:.06em;text-transform:uppercase;width:130px;vertical-align:top">' + esc(k) + '</td><td style="padding:5px 0;color:#0b2239;font-size:15px;font-weight:600">' + esc(v) + "</td></tr>";
  const button = (href: string, label: string, bg: string) => '<a href="' + esc(href) + '" style="display:inline-block;background:' + bg + ';color:' + (bg === "#0b2239" ? "#ffffff" : "#0b2239") + ';text-decoration:none;font-weight:bold;font-size:15px;padding:13px 26px;border-radius:8px;margin:0 8px 8px 0">' + esc(label) + "</a>";
  const html = '<!doctype html><html><body style="margin:0;padding:0;background:#eef3f6"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3f6;padding:24px 12px"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dce6ec;font-family:Arial,Helvetica,sans-serif;color:#102a43"><tr><td style="height:5px;background:#0b2239;line-height:5px;font-size:0"><div style="width:30%;height:5px;background:#c4912a"></div></td></tr><tr><td style="padding:26px 32px 6px"><table role="presentation" cellpadding="0" cellspacing="0" style="border:0"><tr><td style="padding:0 12px 0 0"><img src="' + site + '/egl-mark.png" alt="ERSY GLOBAL" width="78" style="display:block;border:0;height:auto"></td><td style="font-family:Arial,Helvetica,sans-serif;line-height:1"><div style="font-size:22px;font-weight:bold;color:#0b2a52">ERSY <span style="color:#b07d12">GLOBAL</span></div><div style="font-size:10px;font-weight:bold;letter-spacing:4px;color:#0b2a52;margin-top:5px">LOGISTICS</div></td></tr></table></td></tr><tr><td style="padding:14px 32px 0"><h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;color:#0b2239">' + esc(stage.title) + '</h1><p style="margin:0;font-size:15px;line-height:1.6;color:#354a59">' + esc(stage.body) + '</p></td></tr><tr><td style="padding:20px 32px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f8fa;border:1px solid #dce6ec;border-left:4px solid #c4912a;border-radius:8px"><tr><td style="padding:12px 18px"><table role="presentation" cellpadding="0" cellspacing="0" width="100%">' + rows.map(([k, v]) => row(k, v)).join("") + '</table></td></tr></table></td></tr><tr><td style="padding:22px 32px 6px">' + (link ? button(link, "Track your shipment", "#c4912a") : "") + button(site + "/myegl/", "View order in MyEGL", link ? "#0b2239" : "#c4912a") + '</td></tr><tr><td style="padding:26px 32px 28px"><p style="margin:0;font-size:14px;line-height:1.6;color:#354a59">Kind regards,<br><strong style="color:#0b2239">ERSY GLOBAL</strong></p></td></tr><tr><td style="background:#f3f8fa;border-top:1px solid #dce6ec;padding:16px 32px;font-size:12px;line-height:1.7;color:#5b6f7f">Questions? Reply to this email or contact <a href="mailto:sales@ersygloballogistics.com" style="color:#8a6212">sales@ersygloballogistics.com</a> &middot; +971 55 658 1004<br>CWS-1V-1000834, 26th Floor, Amber Gem Tower, Ajman, United Arab Emirates</td></tr></table></td></tr></table></body></html>';
  return { subject: stage.title + " – " + ref, text, html };
}

Deno.serve(async req => {
  const origin = req.headers.get("origin");
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": origin === site || origin === "https://ersygloballogistics.com" ? origin! : site, "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info", "Access-Control-Allow-Methods": "POST,OPTIONS", "Vary": "Origin" };
  const respond = (status: number, value: unknown) => new Response(JSON.stringify(typeof value === "string" ? { message: value } : value), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return respond(405, "Method not allowed");
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return respond(401, "Sign in required");
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), key = Deno.env.get("RESEND_API_KEY");
  if (!url || !anon || !service) return respond(503, "Server configuration unavailable");
  const { data: { user }, error: authError } = await createClient(url, anon).auth.getUser(auth.slice(7));
  if (authError || !user) return respond(401, "Please sign in again with your administrator account.");
  if (user.app_metadata?.myegl_role !== "admin") return respond(403, "Administrator access required");
  let body: any; try { body = await req.json(); } catch { return respond(400, "Invalid request"); }
  if (typeof body.job_id !== "string" || !uuid.test(body.job_id)) return respond(400, "Invalid order");
  const admin = createClient(url, service);
  const { data: job } = await admin.from("portal_jobs").select("id,reference,customer_email,shipment_status,shipment_notified_status,tracking_number,tracking_carrier,estimated_transit_date").eq("id", body.job_id).maybeSingle();
  if (!job) return respond(404, "Order not found");
  if (!STAGES[job.shipment_status]) return respond(200, { message: "No customer email is sent for this stage.", email_sent: false });
  if (job.shipment_notified_status === job.shipment_status) return respond(200, { message: "The customer was already told about this stage.", email_sent: false, already_sent: true });
  const to = String(job.customer_email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return respond(200, { message: "This order has no valid customer email address, so no status email was sent.", email_sent: false });
  if (!key) return respond(503, "Email service is unavailable. Nothing was sent.");
  // Claim this stage first so a double click cannot send the same email twice. Release it if sending fails.
  let claim = admin.from("portal_jobs").update({ shipment_notified_status: job.shipment_status }).eq("id", job.id).eq("shipment_status", job.shipment_status);
  claim = job.shipment_notified_status === null ? claim.is("shipment_notified_status", null) : claim.eq("shipment_notified_status", job.shipment_notified_status);
  const { data: claimed } = await claim.select("id").maybeSingle();
  if (!claimed) return respond(200, { message: "The customer was already told about this stage.", email_sent: false, already_sent: true });
  const mail = buildStatusEmail(job);
  const release = () => admin.from("portal_jobs").update({ shipment_notified_status: job.shipment_notified_status }).eq("id", job.id);
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json", "Idempotency-Key": "myegl-status-" + job.id + "-" + job.shipment_status }, body: JSON.stringify({ from: "ERSY GLOBAL Orders <quotes@send.ersygloballogistics.com>", to: [to], reply_to: "sales@ersygloballogistics.com", subject: mail.subject, text: mail.text, html: mail.html }) });
    const result = await r.json().catch(() => ({}));
    if (!r.ok || !result.id) { await release(); return respond(200, { message: "The status email was not accepted. Nothing was sent. Please save again to retry.", email_sent: false }); }
    return respond(200, { message: "Status email accepted for sending to " + to + ".", email_sent: true, to });
  } catch {
    await release();
    return respond(200, { message: "The status email could not be sent. Please save again to retry.", email_sent: false });
  }
});
