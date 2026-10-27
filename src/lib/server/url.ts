import type { NextRequest } from "next/server";

/** Public base URL for links sent to contacts. Prefer the configured URL over request headers. */
export function appUrl(req: NextRequest): string {
  const configured = process.env.APP_URL?.replace(/\/+$/, "");
  return configured || req.nextUrl.origin;
}

export function shareUrl(req: NextRequest, token: string) {
  return `${appUrl(req)}/t/${token}`;
}
