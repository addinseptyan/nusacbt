/** @param {NodeJS.ProcessEnv} [env] */
export function sessionCookieSecure(env = process.env) {
  const setting = env.NUSACBT_COOKIE_SECURE;
  if (!setting) return env.NODE_ENV === "production";
  if (setting === "true") return true;
  if (setting === "false") return false;
  throw new Error("NUSACBT_COOKIE_SECURE harus true atau false.");
}

/**
 * @param {boolean} secure
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {"strict" | "lax" | "none"}
 */
export function sessionCookieSameSite(secure, env = process.env) {
  const setting = env.NUSACBT_COOKIE_SAMESITE;
  if (!setting) return "strict";
  if (setting !== "strict" && setting !== "lax" && setting !== "none") {
    throw new Error("NUSACBT_COOKIE_SAMESITE harus strict, lax, atau none.");
  }
  if (setting === "none" && !secure) {
    throw new Error("NUSACBT_COOKIE_SAMESITE=none memerlukan NUSACBT_COOKIE_SECURE=true.");
  }
  return setting;
}

/**
 * @param {boolean} secure
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function sessionCookiePartitioned(secure, env = process.env) {
  const setting = env.NUSACBT_COOKIE_PARTITIONED;
  if (!setting || setting === "false") return false;
  if (setting !== "true") {
    throw new Error("NUSACBT_COOKIE_PARTITIONED harus true atau false.");
  }
  if (!secure) {
    throw new Error("NUSACBT_COOKIE_PARTITIONED=true memerlukan NUSACBT_COOKIE_SECURE=true.");
  }
  return true;
}

/**
 * @param {string} path
 * @param {number} maxAge
 * @param {NodeJS.ProcessEnv} [env]
 * @param {boolean} [secureOverride]
 */
export function buildSessionCookieOptions(path, maxAge, env = process.env, secureOverride) {
  const secure = typeof secureOverride === "boolean" ? secureOverride : sessionCookieSecure(env);
  const sameSite = sessionCookieSameSite(secure, env);
  const partitioned = sessionCookiePartitioned(secure, env);
  return {
    httpOnly: true,
    secure,
    sameSite,
    path,
    maxAge,
    ...(partitioned ? { partitioned: true } : {}),
  };
}
