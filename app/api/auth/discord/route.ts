import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function safeReturnTo(value: string | null): string {
  return value?.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/";
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const invite = url.searchParams.get("invite") ?? "";
  const state = randomBytes(32).toString("base64url");
  const appUrl = process.env.TFTOURNEY_APP_URL ?? url.origin;
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId || !process.env.DISCORD_CLIENT_SECRET) return Response.json({ error: "Discord OAuth is not configured." }, { status: 503 });
  const authorize = new URL("https://discord.com/oauth2/authorize");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("redirect_uri", `${appUrl.replace(/\/$/, "")}/api/auth/discord/callback`);
  authorize.searchParams.set("scope", "identify guilds.join");
  authorize.searchParams.set("state", state);
  const response = NextResponse.redirect(authorize);
  response.cookies.set("tftourney-discord-state", state, { httpOnly: true, maxAge: 600, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/auth/discord" });
  response.cookies.set("tftourney-discord-invite", invite, { httpOnly: true, maxAge: 600, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/auth/discord" });
  response.cookies.set("tftourney-discord-return-to", safeReturnTo(url.searchParams.get("returnTo")), { httpOnly: true, maxAge: 600, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/auth/discord" });
  return response;
}
