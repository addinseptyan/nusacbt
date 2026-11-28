export function sessionCookieSecure(env?: NodeJS.ProcessEnv): boolean;
export function sessionCookieSameSite(secure: boolean, env?: NodeJS.ProcessEnv): "strict" | "lax" | "none";
export function sessionCookiePartitioned(secure: boolean, env?: NodeJS.ProcessEnv): boolean;
export function buildSessionCookieOptions(
  path: string,
  maxAge: number,
  env?: NodeJS.ProcessEnv,
  secureOverride?: boolean,
): {
  httpOnly: true;
  secure: boolean;
  sameSite: "strict" | "lax" | "none";
  path: string;
  maxAge: number;
  partitioned?: true;
};
