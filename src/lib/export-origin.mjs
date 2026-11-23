/** @param {Headers} headers @returns {boolean} */
function requestOriginMatchesHost(headers) {
  const origin = headers.get("origin");
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  const proto = headers.get("x-forwarded-proto");
  const site = headers.get("sec-fetch-site");
  if (
    !origin ||
    !host ||
    /[\s,\/\\]/.test(host) ||
    (proto && !/^(http|https)$/.test(proto)) ||
    (site && site !== "same-origin")
  ) {
    return false;
  }
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.origin === origin &&
      url.host.toLowerCase() === host.toLowerCase() &&
      (!proto || url.protocol === `${proto}:`)
    );
  } catch {
    return false;
  }
}

/** @param {Headers} headers @returns {boolean} */
export function exportRequestIsSameOrigin(headers) {
  const contentType = headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  return (
    contentType === "application/json" &&
    headers.get("x-nusacbt-export") === "1" &&
    requestOriginMatchesHost(headers)
  );
}

/** @param {Headers} headers @returns {boolean} */
export function toolMultipartRequestIsSameOrigin(headers) {
  const contentType = headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  return (
    contentType === "multipart/form-data" &&
    headers.get("x-nusacbt-tool") === "1" &&
    requestOriginMatchesHost(headers)
  );
}
