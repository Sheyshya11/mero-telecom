export const MERO_TELECOM_LOGO_PATH = '/brand/mero-telecom-logo.jpg';

export function renderEmailLogo(brandLogoUrl: string): string {
  return `<img src="${escapeAttribute(brandLogoUrl)}" alt="Mero Telecom" width="240" style="display:block;width:240px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none">`;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
