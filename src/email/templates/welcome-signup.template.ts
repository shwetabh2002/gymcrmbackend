import { WelcomeSignupEmailInput } from '../email.types';

export function welcomeSignupSubject(gymName: string): string {
  return `Welcome to GymFlow — ${gymName} is ready`;
}

export function welcomeSignupText(input: WelcomeSignupEmailInput): string {
  return [
    `Hi ${input.adminName},`,
    '',
    `Your gym workspace "${input.gymName}" is ready on GymFlow.`,
    '',
    'Login details:',
    `Email: ${input.email}`,
    `Password: ${input.password}`,
    '',
    `Open CRM: ${input.loginUrl}`,
    '',
    'For security, change your password after you sign in.',
    '',
    '— GymFlow',
  ].join('\n');
}

export function welcomeSignupHtml(input: WelcomeSignupEmailInput): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#0f1115;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1115;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:520px;background:#171a20;border:1px solid rgba(243,241,235,0.12);border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:28px 28px 8px;">
              <p style="margin:0;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:#8a857c;">GymFlow</p>
              <h1 style="margin:12px 0 0;font-size:22px;line-height:1.25;color:#f3f1eb;">Your gym workspace is ready</h1>
              <p style="margin:12px 0 0;font-size:15px;line-height:1.5;color:#bdb8ae;">
                Hi ${esc(input.adminName)}, <strong style="color:#f3f1eb;">${esc(input.gymName)}</strong> is set up.
                Use the login below to open your CRM.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 8px;">
              <table role="presentation" width="100%" style="background:#0f1115;border:1px solid rgba(243,241,235,0.1);border-radius:8px;">
                <tr>
                  <td style="padding:16px;">
                    <p style="margin:0 0 8px;font-size:12px;color:#8a857c;text-transform:uppercase;letter-spacing:0.08em;">Login</p>
                    <p style="margin:0;font-size:14px;color:#bdb8ae;">Email</p>
                    <p style="margin:4px 0 12px;font-size:15px;color:#f3f1eb;"><code style="font-family:ui-monospace,monospace;">${esc(input.email)}</code></p>
                    <p style="margin:0;font-size:14px;color:#bdb8ae;">Password</p>
                    <p style="margin:4px 0 0;font-size:15px;color:#f3f1eb;"><code style="font-family:ui-monospace,monospace;">${esc(input.password)}</code></p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 28px;" align="center">
              <a href="${esc(input.loginUrl)}"
                 style="display:inline-block;background:#e23d2b;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:6px;">
                Open CRM
              </a>
              <p style="margin:16px 0 0;font-size:12px;line-height:1.45;color:#8a857c;">
                Change your password after you sign in.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
