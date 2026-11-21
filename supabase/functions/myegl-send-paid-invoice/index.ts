import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const site = "https://www.ersygloballogistics.com";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const methods: Record<string, string> = { bank_transfer: "Bank transfer", card: "Card payment", paypal: "PayPal", cash: "Cash", other: "Other" };
const dubaiDate = (v: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "2-digit", month: "short", year: "numeric" }).format(new Date(v));

export function buildPaidEmail(inv: any, job: any) {
  const ref = String(job?.reference || "");
  const amount = (inv.currency || "AED") + " " + Number(inv.amount_paid).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const paidOn = inv.paid_at ? dubaiDate(inv.paid_at) : dubaiDate(new Date().toISOString());
  const method = methods[inv.payment_method] || "";
  const row = (k: string, v: string) => '<tr><td style="padding:5px 0;color:#5b6f7f;font-size:12px;letter-spacing:.06em;text-transform:uppercase;width:110px;vertical-align:top">' + k + '</td><td style="padding:5px 0;color:#0b2239;font-size:15px;font-weight:600">' + esc(v) + "</td></tr>";
  const text = ["Payment received. Thank you.", "", "Invoice: " + inv.invoice_number, ref ? "Order reference: " + ref : "", "Amount paid: " + amount, "Paid on: " + paidOn, "", "Your paid invoice is attached for your records.", "You can also view your orders in MyEGL: " + site + "/myegl/", "", "ERSY GLOBAL"].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
  const html = '<!doctype html><html><body style="margin:0;padding:0;background:#eef3f6"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3f6;padding:24px 12px"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dce6ec;font-family:Arial,Helvetica,sans-serif;color:#102a43"><tr><td style="height:5px;background:#0b2239;line-height:5px;font-size:0"><div style="width:30%;height:5px;background:#c4912a"></div></td></tr><tr><td style="padding:26px 32px 6px"><table role="presentation" cellpadding="0" cellspacing="0" style="border:0"><tr><td style="padding:0 12px 0 0"><img src="' + site + '/egl-mark.png" alt="ERSY GLOBAL" width="78" style="display:block;border:0;height:auto"></td><td style="font-family:Arial,Helvetica,sans-serif;line-height:1"><div style="font-size:22px;font-weight:bold;color:#0b2a52">ERSY <span style="color:#b07d12">GLOBAL</span></div><div style="font-size:10px;font-weight:bold;letter-spacing:4px;color:#0b2a52;margin-top:5px">LOGISTICS</div></td></tr></table></td></tr><tr><td style="padding:14px 32px 0"><h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;color:#0b2239">Payment received. Thank you.</h1><p style="margin:0;font-size:15px;line-height:1.6;color:#354a59">We have received your payment. Your paid invoice is attached to this email for your records.</p></td></tr><tr><td style="padding:20px 32px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef8f1;border:1px solid #b5dcc4;border-left:4px solid #15803d;border-radius:8px"><tr><td style="padding:12px 18px"><table role="presentation" cellpadding="0" cellspacing="0" width="100%">' + row("Invoice", inv.invoice_number) + (ref ? row("Order", ref) : "") + row("Amount paid", amount) + row("Paid on", paidOn) + (method ? row("Method", method) : "") + '</table></td></tr></table></td></tr><tr><td style="padding:22px 32px 6px"><a href="' + site + '/myegl/" style="display:inline-block;background:#c4912a;color:#0b2239;text-decoration:none;font-weight:bold;font-size:15px;padding:13px 26px;border-radius:8px">View your orders in MyEGL</a></td></tr><tr><td style="padding:26px 32px 28px"><p style="margin:0;font-size:14px;line-height:1.6;color:#354a59">Kind regards,<br><strong style="color:#0b2239">ERSY GLOBAL</strong></p></td></tr><tr><td style="background:#f3f8fa;border-top:1px solid #dce6ec;padding:16px 32px;font-size:12px;line-height:1.7;color:#5b6f7f">Questions? Reply to this email or contact <a href="mailto:sales@ersygloballogistics.com" style="color:#8a6212">sales@ersygloballogistics.com</a> &middot; +971 55 658 1004<br>CWS-1V-1000834, 26th Floor, Amber Gem Tower, Ajman, United Arab Emirates</td></tr></table></td></tr></table></body></html>';
  return { subject: "Payment received – paid invoice " + inv.invoice_number, text, html };
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
  if (typeof body.invoice_id !== "string" || !uuid.test(body.invoice_id)) return respond(400, "Select one valid invoice");
  const pdf = typeof body.pdf_base64 === "string" ? body.pdf_base64 : "";
  if (!pdf.startsWith("JVBER") || pdf.length > 4_000_000 || !/^[A-Za-z0-9+/=]+$/.test(pdf)) return respond(400, "The paid invoice PDF is missing or invalid. Nothing was sent.");
  const admin = createClient(url, service);
  const { data: inv, error } = await admin.from("myegl_invoices").select("*").eq("id", body.invoice_id).single();
  if (error || !inv) return respond(404, "Invoice not found");
  if (inv.status !== "paid") return respond(409, "Only a paid invoice can be sent as a paid invoice. Mark it as paid first.");
  const { data: job } = await admin.from("portal_jobs").select("reference,customer_email").eq("id", inv.job_id).maybeSingle();
  const to = String(inv.customer_email || job?.customer_email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return respond(409, "This invoice has no valid customer email address.");
  if (inv.paid_email_sent_at && body.resend !== true) return respond(409, { message: "The paid invoice was already emailed on " + dubaiDate(inv.paid_email_sent_at) + ".", already_sent: true, sent_at: inv.paid_email_sent_at });
  if (!key) return respond(503, "Email service is unavailable. Nothing was sent.");
  const mail = buildPaidEmail(inv, job);
  const filename = "ERSY-GLOBAL-Paid-Invoice-" + String(inv.invoice_number).replace(/[^A-Za-z0-9-]/g, "") + ".pdf";
  try {
    const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json", "Idempotency-Key": "myegl-paid-" + inv.id + "-" + (body.resend === true ? Date.now() : "first") }, body: JSON.stringify({ from: "ERSY GLOBAL Accounts <quotes@send.ersygloballogistics.com>", to: [to], reply_to: "sales@ersygloballogistics.com", subject: mail.subject, text: mail.text, html: mail.html, attachments: [{ filename, content: pdf }] }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.id) return respond(200, { message: "The email was not accepted. Nothing was recorded as sent. Please try again.", email_sent: false });
    await admin.from("myegl_invoices").update({ paid_email_id: result.id, paid_email_sent_at: new Date().toISOString() }).eq("id", inv.id);
    return respond(200, { message: "Paid invoice accepted for sending to " + to + ". Inbox delivery is not yet confirmed.", email_sent: true, email_id: result.id, to });
  } catch {
    return respond(200, { message: "Email sending could not be confirmed. Please check before sending again.", email_sent: false });
  }
});
