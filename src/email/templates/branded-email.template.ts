/**
 * Wraps a gym's plain-text template body in a branded HTML shell.
 *
 * Gyms write plain text (easy, no HTML mistakes); this renders it with their
 * logo, accent colour and contact footer. Inline styles only — email clients
 * ignore <style> blocks and external CSS.
 */

const FALLBACK_ACCENT = '#E23D2B';

/** Email clients receive untrusted-looking HTML; escape everything we inject. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Turns bare URLs into links after escaping, so text bodies stay clickable. */
function linkify(escaped: string): string {
  return escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) =>
      `<a href="${url}" style="color:inherit;text-decoration:underline;">${url}</a>`,
  );
}

export function emailBodyToHtml(input: {
  body: string;
  gymName: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  footer?: string;
}): string {
  const accent = input.primaryColor || FALLBACK_ACCENT;
  const paragraphs = escapeHtml(input.body)
    .split(/\n{2,}/)
    .map(
      (block) =>
        `<p style="margin:0 0 14px;line-height:1.6;">${linkify(
          block.replace(/\n/g, '<br />'),
        )}</p>`,
    )
    .join('');

  const header = input.logoUrl
    ? `<img src="${input.logoUrl}" alt="${escapeHtml(input.gymName)}" style="max-height:48px;max-width:180px;display:block;" />`
    : `<div style="font-size:20px;font-weight:600;color:${accent};">${escapeHtml(
        input.gymName,
      )}</div>`;

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1a1a1a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="padding:24px 28px 0;">${header}</td>
      </tr>
      <tr>
        <td style="height:3px;background:${accent};margin:0;"></td>
      </tr>
      <tr>
        <td style="padding:24px 28px;font-size:15px;">${paragraphs}</td>
      </tr>
      ${
        input.footer
          ? `<tr><td style="padding:0 28px 24px;font-size:13px;color:#6b7280;border-top:1px solid #f0f0f0;padding-top:16px;">${escapeHtml(
              input.footer,
            )}</td></tr>`
          : ''
      }
    </table>
  </body>
</html>`;
}
