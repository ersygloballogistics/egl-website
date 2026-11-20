import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const allowed = new Set(["https://ersygloballogistics.github.io","https://ersygloballogistics.com","https://www.ersygloballogistics.com","https://ersyglobal.com","https://www.ersyglobal.com"]);
const MAX_FILES = 5, MAX_BYTES = 10 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
const cors = (origin: string) => ({ "Content-Type": "application/json", "Access-Control-Allow-Origin": allowed.has(origin) ? origin : "https://www.ersygloballogistics.com", "Vary": "Origin", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type" });

// File type is decided from the first bytes of the file, never from its name or the browser's label.
function sniff(b: Uint8Array): { ext: string; mime: string } | null {
  const s = (i: number, str: string) => str.split("").every((c, k) => b[i + k] === c.charCodeAt(0));
  if (s(0, "%PDF-")) return { ext: "pdf", mime: "application/pdf" };
  if (b[0] === 0x89 && s(1, "PNG")) return { ext: "png", mime: "image/png" };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (s(0, "RIFF") && s(8, "WEBP")) return { ext: "webp", mime: "image/webp" };
  if (b[0] === 0x50 && b[1] === 0x4b) return null; // zip: decided by extension below
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return null; // legacy Office: decided by extension below
  return null;
}
const OFFICE: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  doc: "application/msword",
};
function classify(name: string, b: Uint8Array): { ext: string; mime: string } | null {
  const known = sniff(b);
  if (known) return known;
  const ext = (name.split(".").pop() || "").toLowerCase();
  const zip = b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
  const ole = b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
  if ((ext === "xlsx" || ext === "docx") && zip) return { ext, mime: OFFICE[ext] };
  if ((ext === "xls" || ext === "doc") && ole) return { ext, mime: OFFICE[ext] };
  if ((ext === "txt" || ext === "csv") && !b.slice(0, 2000).some(x => x === 0)) return { ext, mime: ext === "csv" ? "text/csv" : "text/plain" };
  return null;
}
const safeName = (name: string, ext: string) => {
  const base = name.replace(/\.[^.]*$/, "").normalize("NFKD").replace(/[^A-Za-z0-9 _-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "file";
  return base + "." + ext;
};

Deno.serve(async req => {
  const origin = req.headers.get("origin") || "";
  const headers = cors(origin);
  const reply = (status: number, value: unknown) => new Response(JSON.stringify(typeof value === "string" ? { error: value } : value), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, "Method not allowed");
  if (!allowed.has(origin)) return reply(403, "Origin not allowed");
  const url = Deno.env.get("SUPABASE_URL"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) return reply(503, "Service unavailable");
  let form: FormData;
  try { form = await req.formData(); } catch { return reply(400, "Invalid upload"); }
  const jobId = String(form.get("job_id") || ""), token = String(form.get("token") || "");
  if (!uuid.test(jobId)) return reply(400, "Invalid request");
  // The token is created by website-quote-intake with the same secret.
  const [expiresText, signature] = token.split(".");
  const expires = Number(expiresText);
  if (!signature || !Number.isFinite(expires) || expires < Date.now()) return reply(403, "This upload link has expired. Please send the files by email or WhatsApp.");
  const secret = Deno.env.get("WEBSITE_INTAKE_SALT") || service;
  const hmacKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify", "sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode("upload:" + jobId + ":" + expires)));
  if (expected.length !== signature.length || !expected.split("").every((c, i) => c === signature[i])) return reply(403, "Invalid upload token");
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return reply(400, "No files were attached");
  if (files.length > MAX_FILES) return reply(400, "You can attach up to " + MAX_FILES + " files");
  for (const f of files) if (f.size > MAX_BYTES) return reply(413, "Each file must be 10 MB or smaller: " + f.name.slice(0, 60));

  const admin = createClient(url, service);
  const { data: job } = await admin.from("portal_jobs").select("id,reference,customer_email,service_type").eq("id", jobId).maybeSingle();
  if (!job) return reply(404, "Request not found");
  const { count } = await admin.from("myegl_job_files").select("id", { count: "exact", head: true }).eq("job_id", jobId);
  if ((count || 0) + files.length > MAX_FILES) return reply(409, "This request already has the maximum number of files");

  const saved: { name: string; size: number }[] = [], rejected: string[] = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const kind = classify(f.name, bytes);
    if (!kind) { rejected.push(f.name.slice(0, 80)); continue; }
    const path = jobId + "/" + crypto.randomUUID() + "-" + safeName(f.name, kind.ext);
    const up = await admin.storage.from("rfq-files").upload(path, bytes, { contentType: kind.mime, upsert: false });
    if (up.error) { rejected.push(f.name.slice(0, 80)); continue; }
    const row = await admin.from("myegl_job_files").insert({ job_id: jobId, storage_path: path, file_name: safeName(f.name, kind.ext), mime_type: kind.mime, size_bytes: bytes.length });
    if (row.error) { await admin.storage.from("rfq-files").remove([path]); rejected.push(f.name.slice(0, 80)); continue; }
    saved.push({ name: safeName(f.name, kind.ext), size: bytes.length });
  }
  if (!saved.length) return reply(400, { error: "None of the files could be accepted. Please use PDF, image, Word, Excel, CSV or text files.", rejected });

  const key = Deno.env.get("RESEND_API_KEY");
  if (key) {
    try {
      const list = saved.map(f => "- " + f.name + " (" + Math.max(1, Math.round(f.size / 1024)) + " KB)").join("\n");
      const text = ["The customer attached " + saved.length + " file(s) to request " + job.reference + ".", "", list, "", "Customer: " + job.customer_email, "Service: " + job.service_type, "", "Open the request in the MyEGL administrator workspace to view the files. They are private and are not attached to this email."].join("\n");
      await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify({ from: "ERSY GLOBAL Quotes <quotes@send.ersygloballogistics.com>", to: ["sales@ersygloballogistics.com"], reply_to: job.customer_email, subject: "Files added to " + job.reference, text }) });
    } catch { console.error("File notification failed"); }
  }
  return reply(200, { ok: true, saved: saved.length, rejected });
});
