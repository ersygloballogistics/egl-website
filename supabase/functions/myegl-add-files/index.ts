import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const allowed = ["https://www.ersygloballogistics.com", "https://ersygloballogistics.com"];
const MAX_PER_UPLOAD = 5, MAX_TOTAL = 20, MAX_BYTES = 10 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cors = (req: Request) => { const o = req.headers.get("origin") || ""; return { "Content-Type": "application/json", "Access-Control-Allow-Origin": allowed.includes(o) ? o : allowed[0], "Vary": "Origin", "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info", "Access-Control-Allow-Methods": "POST,OPTIONS" }; };

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
  const headers = cors(req);
  const reply = (status: number, value: unknown) => new Response(JSON.stringify(typeof value === "string" ? { error: value } : value), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, "Method not allowed");
  const token = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  if (!token) return reply(401, "Sign in required");
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply(503, "Service unavailable");
  const { data: { user }, error } = await createClient(url, anon).auth.getUser(token);
  if (error || !user) return reply(401, "Please sign in again.");
  let form: FormData;
  try { form = await req.formData(); } catch { return reply(400, "Invalid upload"); }
  const jobId = String(form.get("job_id") || "");
  if (!uuid.test(jobId)) return reply(400, "Invalid request");
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return reply(400, "Choose at least one file");
  if (files.length > MAX_PER_UPLOAD) return reply(400, "You can upload up to " + MAX_PER_UPLOAD + " files at a time");
  for (const f of files) if (f.size > MAX_BYTES) return reply(413, "Each file must be 10 MB or smaller: " + f.name.slice(0, 60));
  const admin = createClient(url, service);
  const isAdmin = user.app_metadata?.myegl_role === "admin";
  const { data: job } = await admin.from("portal_jobs").select("id,reference,customer_id,customer_email,service_type").eq("id", jobId).maybeSingle();
  if (!job || (!isAdmin && job.customer_id !== user.id)) return reply(404, "Request not found");
  const { count } = await admin.from("myegl_job_files").select("id", { count: "exact", head: true }).eq("job_id", jobId);
  if ((count || 0) + files.length > MAX_TOTAL) return reply(409, "This request can hold up to " + MAX_TOTAL + " files");

  const saved: { name: string; size: number }[] = [], rejected: string[] = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const kind = classify(f.name, bytes);
    if (!kind) { rejected.push(f.name.slice(0, 80)); continue; }
    const path = jobId + "/" + crypto.randomUUID() + "-" + safeName(f.name, kind.ext);
    const up = await admin.storage.from("rfq-files").upload(path, bytes, { contentType: kind.mime, upsert: false });
    if (up.error) { console.error("Storage upload failed", up.error.message); return reply(502, "The file could not be stored. Please try again."); }
    const row = await admin.from("myegl_job_files").insert({ job_id: jobId, storage_path: path, file_name: safeName(f.name, kind.ext), mime_type: kind.mime, size_bytes: bytes.length, uploaded_by: isAdmin ? "ersy" : "customer" });
    if (row.error) { console.error("File record failed", row.error.message); await admin.storage.from("rfq-files").remove([path]); return reply(502, "The file could not be saved. Please try again."); }
    saved.push({ name: safeName(f.name, kind.ext), size: bytes.length });
  }
  if (!saved.length) return reply(400, { error: "These files are not accepted. Please use PDF, image, Word, Excel, CSV or text files.", rejected });

  const key = Deno.env.get("RESEND_API_KEY");
  if (key && !isAdmin) {
    try {
      const list = saved.map(f => "- " + f.name + " (" + Math.max(1, Math.round(f.size / 1024)) + " KB)").join("\n");
      const text = ["The customer added " + saved.length + " file(s) to request " + job.reference + ".", "", list, "", "Customer: " + job.customer_email, "Service: " + job.service_type, "", "Open the request in the MyEGL administrator workspace to view the files. They are private and are not attached to this email."].join("\n");
      await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify({ from: "ERSY GLOBAL MyEGL <noreply@send.ersygloballogistics.com>", to: ["sales@ersygloballogistics.com"], reply_to: job.customer_email, subject: "Files added to " + job.reference, text }) });
    } catch { console.error("File notification failed"); }
  }
  return reply(200, { ok: true, saved: saved.length, rejected });
});
