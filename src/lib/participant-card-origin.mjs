// Endpoint kartu hanya menerima fetch JSON yang berasal dari origin aplikasi.
// Proxy tepercaya harus mengganti (bukan meneruskan bebas) X-Forwarded-Host dan
// X-Forwarded-Proto. Cookie SameSite bukan satu-satunya pemeriksaan CSRF.
/** @param {Headers} headers @returns {boolean} */
export function cardRequestIsSameOrigin(headers) {
  const origin = headers.get('origin');
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  const proto = headers.get('x-forwarded-proto');
  const site = headers.get('sec-fetch-site');
  const contentType = headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (!origin || !host || /[\s,\/\\]/.test(host) || (proto && !/^(http|https)$/.test(proto)) ||
      (site && site !== 'same-origin') || contentType !== 'application/json' ||
      headers.get('x-nusacbt-cards') !== '1') return false;
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === origin &&
      url.host.toLowerCase() === host.toLowerCase() && (!proto || url.protocol === `${proto}:`);
  } catch { return false; }
}
