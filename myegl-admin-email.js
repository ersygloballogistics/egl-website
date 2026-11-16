// Administrator-only email actions. Opening a preview never sends mail.
export function appendAdminEmailAction(container, client, options) {
  const make = (tag, value) => { const e = document.createElement(tag); e.textContent = value || ''; return e; };
  const registration = options.action === 'registration';
  const root = make('div'); root.className = 'admin-email-action';
  root.style.cssText = 'margin:12px 0;max-width:100%;overflow-wrap:anywhere';
  const open = make('button', registration ? 'Email registration link' : 'Email quotation and account link');
  open.type = 'button'; open.className = 'secondary';
  const status = make('p'); status.setAttribute('role', 'status');
  const preview = make('div'); preview.hidden = true;
  preview.style.cssText = 'border:1px solid #cbdce4;border-radius:10px;padding:16px;margin-top:12px;background:#f7fbfc';
  root.append(open, status, preview); container.append(root);
  const payload = { action: registration ? 'registration' : 'quotation' };
  if (options.job_id) payload.job_id = options.job_id;
  else if (options.record_type === 'job') payload.job_id = options.record_id;
  else if (options.record_type === 'rfq') payload.rfq_id = options.record_id;
  else { open.disabled = true; return; }
  async function invoke(body) {
    let { data: { session } } = await client.auth.getSession();
    if (session?.expires_at && session.expires_at * 1000 < Date.now() + 60000) {
      const refreshed = await client.auth.refreshSession(); session = refreshed.data?.session;
    }
    if (!session?.access_token) throw new Error('Please sign in again with an administrator account.');
    const { data, error } = await client.functions.invoke('myegl-send-quotation', {
      headers: { Authorization: 'Bearer ' + session.access_token }, body
    });
    if (error) {
      let message = error.message;
      try { const detail = await error.context?.json(); message = detail?.message || message; } catch {}
      throw new Error(message || 'Unable to contact the email service.');
    }
    return data;
  }
  open.onclick = async () => {
    open.disabled = true; status.textContent = 'Preparing email preview…'; preview.hidden = true;
    try {
      const data = await invoke({ ...payload, preview: true });
      if (!data?.email_preview) throw new Error(data?.message || 'Email preview unavailable.');
      const email = data.email_preview;
      preview.replaceChildren(make('h3', 'Email preview'), make('p', 'To: ' + email.to), make('p', 'Subject: ' + email.subject));
      const body = make('div', email.text); body.style.cssText = 'white-space:pre-wrap;line-height:1.55;overflow-wrap:anywhere';
      const send = make('button', 'Send email to customer'); send.type = 'button';
      const close = make('button', 'Close preview'); close.type = 'button'; close.className = 'secondary'; close.style.margin = '8px';
      close.onclick = () => { preview.hidden = true; status.textContent = ''; };
      preview.append(body, make('p', 'Review the recipient and message before sending.'), send, close); preview.hidden = false;
      status.textContent = 'Preview ready. No email has been sent.';
      send.onclick = async () => {
        if (!confirm('Send this ' + (registration ? 'registration email' : 'quotation email') + ' to ' + email.to + '?')) return;
        send.disabled = true; close.disabled = true; open.disabled = true; status.textContent = 'Sending email…';
        try {
          const result = await invoke({ ...payload, expected_hash: email.fingerprint });
          status.textContent = result?.message || 'Email status unavailable.';
          if (result?.email_sent) {
            preview.hidden = true; open.textContent = 'Email accepted for sending'; open.disabled = true;
            if (options.onSent) await options.onSent(result);
          } else { send.disabled = false; send.textContent = 'Retry email'; open.disabled = false; }
        } catch (error) { status.textContent = 'Email not confirmed: ' + error.message; send.disabled = false; open.disabled = false; }
        finally { close.disabled = false; }
      };
    } catch (error) { status.textContent = 'Unable to prepare email: ' + error.message; }
    finally { open.disabled = false; }
  };
  return root;
}
