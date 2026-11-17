/** @param {unknown} value @returns {string | null} */
export function normalizeAdminUsername(value) {
  if (typeof value !== "string" || value.length > 128) return null;
  const username = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{2,63}$/.test(username) ? username : null;
}
