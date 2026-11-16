import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { createQuotationAttachment } from "./quotation-pdf.ts";

const site = "https://www.ersygloballogistics.com";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const lines = value => Array.isArray(value) ? value.map(String) : String(value || "").split(/\r?\n/).filter(Boolean);
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2, "0")).join("");

export function buildEmail(record, action, account) {
  const link = site + (account ? "/myegl/" : "/myegl/?register=1");
  const reference = String(record.reference || "Your request");
  const names = {"shop-ship":"Shop & Ship","buy-for-me":"Buy For Me","freight":"Freight Forwarding","procurement":"Procurement & Sourcing","warehousing":"Warehousing & Fulfillment"};
  const service = names[record.service_type] || String(record.service_type || "Requested service").replaceAll("-", " ");
  const next = !account
    ? "To view and approve your quotation and follow shipment updates, please create a MyEGL account using this email address."
    : account.approved
      ? "To view and approve your quotation and follow shipment updates, please sign in to MyEGL."
      : "To view and approve your quotation, please sign in to MyEGL once your account is approved.";
  const text = ["Thank you for your request.", "", "Reference: " + reference, "Service: " + service,
    "Route: " + (record.origin || "To be confirmed") + " → " + (record.destination || "To be confirmed"),
    "", "Please find your quotation attached.", "", next, link, "", "ERSY GLOBAL"].join("\n");
  const html = '<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#102a43;line-height:1.6"><h2 style="color:#0b2239">ERSY GLOBAL</h2><p>Thank you for your request.</p><p><strong>Reference:</strong> ' + escape(reference) + '<br><strong>Service:</strong> ' + escape(service) + '<br><strong>Route:</strong> ' + escape(record.origin || 'To be confirmed') + ' → ' + escape(record.destination || 'To be confirmed') + '</p><p>Please find your quotation attached.</p><p>' + escape(next) + '</p><p><a href="' + link + '" style="color:#008f91;font-weight:bold">' + (account ? 'View quotation in MyEGL' : 'Create your MyEGL account') + '</a></p><p>ERSY GLOBAL</p></div>';
  return { to: String(record.customer_email).trim().toLowerCase(), subject: "Your ERSY GLOBAL quotation – " + reference, text, html };
}

export function createHandler({ createClient, env, sendEmail = fetch, now = () => new Date(), createAttachment = createQuotationAttachment }) {
  return async req => {
    const origin = req.headers.get("origin");
    const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": origin === site || origin === "https://ersygloballogistics.com" ? origin : site, "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info", "Access-Control-Allow-Methods": "POST,OPTIONS", "Vary": "Origin" };
    const respond = (status, value) => new Response(JSON.stringify(typeof value === "string" ? { message: value } : value), { status, headers });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST") return respond(405, "Method not allowed");
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) return respond(401, "Sign in required");
    const url = env("SUPABASE_URL"), anon = env("SUPABASE_ANON_KEY"), service = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !service) return respond(503, "Server configuration unavailable");
    const client = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: authError } = await client.auth.getUser(auth.slice(7));
    if (authError || !user) return respond(401, "Please sign in again with your administrator account.");
    if (user.app_metadata?.myegl_role !== "admin") return respond(403, "Administrator access required");
    let body; try { body = await req.json(); } catch { return respond(400, "Invalid request"); }
    const action = body.action || "quotation";
    if (action !== "quotation") return respond(400, "Please use Send quotation to email the quotation and account link together.");
    const isJob = typeof body.job_id === "string" && uuid.test(body.job_id);
    const isRfq = typeof body.rfq_id === "string" && uuid.test(body.rfq_id);
    if (isJob === isRfq || (action === "quotation" && !isJob)) return respond(400, "Select one valid request");
    const admin = createClient(url, service);
    const { data: record, error } = await admin.from(isJob ? "portal_jobs" : "myegl_rfqs").select("*").eq("id", isJob ? body.job_id : body.rfq_id).single();
    if (error || !record) return respond(404, "Request not found");
    let account = null;
    if (record.customer_id) {
      const result = await client.from("portal_customers").select("id,email,approved").eq("id", record.customer_id).maybeSingle();
      if (result.error) return respond(500, "Unable to check the customer account");
      account = result.data;
    }
    if (!record.customer_email && account?.email) record.customer_email = account.email;
    if (typeof record.customer_email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.customer_email) || /[\r\n]/.test(record.reference || "")) return respond(409, "A valid customer email and request reference are required");
    if (!account) {
      const literalEmail = record.customer_email.trim().replace(/[\\%_]/g, value => "\\" + value);
      const result = await client.from("portal_customers").select("id,email,approved").ilike("email", literalEmail).maybeSingle();
      if (result.error) return respond(500, "Unable to check the customer account");
      account = result.data;
    }
    if (action === "registration" && account) return respond(409, "The customer already has an account. Review its approval status instead.");
    const issueDate = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now());
    if (action === "quotation") {
      if (!(record.quote_status === "draft" || (record.quote_status === "pending" && !record.quotation_email_id))) return respond(409, "Save a draft quotation before emailing. This quotation may already have been sent.");
      if (!Number.isFinite(Number(record.quoted_total)) || Number(record.quoted_total) <= 0 || !record.currency || !record.quotation_valid_until || String(record.quotation_valid_until) < issueDate) return respond(409, "Save a quotation with a positive amount, currency and current validity date before emailing.");
    }
    const mail = buildEmail(record, action, account);
    const snapshot = {reference:record.reference,customer_email:record.customer_email,customer_name:record.customer_name,request_details:record.request_details,service_type:record.service_type,origin:record.origin,destination:record.destination,currency:record.currency,quoted_total:record.quoted_total,quotation_valid_until:record.quotation_valid_until,estimated_transit_date:record.estimated_transit_date,included_services:record.included_services,quotation_terms:record.quotation_terms};
    const fingerprint = await digest(JSON.stringify({mail,pdf:snapshot,issueDate,version:'attached-quotation-v1'}));
    if (body.expected_hash && body.expected_hash !== fingerprint) return respond(409, "The quotation or customer account changed. Open a new email preview before sending.");
    if (body.preview !== true && !body.expected_hash) return respond(400, "Review the quotation email and attachment before sending.");
    let attachment;
    try { attachment = await createAttachment(record,issueDate); }
    catch { return respond(500, "The quotation PDF could not be prepared. Nothing was sent."); }
    if (!attachment?.content || !attachment?.filename) return respond(500, "The quotation PDF is missing. Nothing was sent.");
    if (body.preview === true) return respond(200, { email_preview: { to: mail.to, subject: mail.subject, text: mail.text, fingerprint, attachment:{filename:attachment.filename,content:attachment.content} }, email_sent: false });
    const key = env("RESEND_API_KEY");
    if (!key) return respond(503, "Email service is unavailable. Nothing was sent; the quotation is unchanged.");
    let published = false;
    if (action === "quotation") {
      if (record.quote_status === "draft") {
        let update = admin.from("portal_jobs").update({ quote_status: "pending", quotation_sent_at: now().toISOString() }).eq("id", record.id).eq("quote_status", "draft");
        if (record.updated_at) update = update.eq("updated_at", record.updated_at);
        const { data: changed, error: updateError } = await update.select("id").maybeSingle();
        if (updateError || !changed) return respond(409, "Quotation changed or could not be published. Refresh the request and review it again.");
      }
      published = true;
    }
    const suffix = action === "registration" ? "-" + now().toISOString().slice(0, 10) : "";
    try {
      const response = await sendEmail("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json", "Idempotency-Key": "myegl-" + action + "-" + record.id + "-" + fingerprint + suffix }, body: JSON.stringify({ from: "ERSY GLOBAL Quotations <quotes@send.ersygloballogistics.com>", to: [mail.to], reply_to: "sales@ersygloballogistics.com", subject: mail.subject, text: mail.text, html: mail.html, attachments: [{filename:attachment.filename,content:attachment.content}] }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.id) return respond(200, { message: (published ? "Quotation published, but " : "") + "email was not accepted. Please retry from this preview.", published, email_sent: false });
      let saved = true;
      if (published) {
        const resultSave = await admin.from("portal_jobs").update({ quotation_email_id: result.id }).eq("id", record.id);
        saved = !resultSave.error;
      }
      return respond(200, { message: (action === "quotation" ? "Quotation email" : "Registration email") + " accepted for sending to " + mail.to + ". Inbox delivery is not yet confirmed." + (saved ? "" : " The email reference could not be saved. Do not resend before checking with Sales."), published, email_sent: true, email_id: result.id });
    } catch {
      return respond(200, { message: (published ? "Quotation published. " : "") + "Email sending could not be confirmed. Retry from this preview; duplicate attempts use the same email reference.", published, email_sent: false });
    }
  };
}

Deno.serve(createHandler({ createClient, env: name => Deno.env.get(name) }));
