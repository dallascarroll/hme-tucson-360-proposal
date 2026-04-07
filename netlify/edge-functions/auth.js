// Netlify Edge Function: auth.js
const SESSION_COOKIE = "dg_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

export default async function handler(request, context) {
  const url = new URL(request.url);

  // Allow static assets through
  if (url.pathname.startsWith("/assets/")) {
    return context.next();
  }

  const TOKEN_SECRET = Deno.env.get("DG_TOKEN_SECRET");
  if (!TOKEN_SECRET) {
    return new Response("Server configuration error.", { status: 500 });
  }

  // Check for existing valid session cookie
  const cookies = request.headers.get("cookie") || "";
  const sessionMatch = cookies.match(/dg_session=([^;]+)/);
  if (sessionMatch) {
    try {
      const sessionData = JSON.parse(atob(sessionMatch[1]));
      if (sessionData.expires > Date.now()) {
        return context.next();
      }
    } catch (e) {
      // invalid cookie, fall through
    }
  }

  // Check for dgtoken — required for access
  const dgtoken = url.searchParams.get("dgtoken");
  if (!dgtoken) {
    return new Response(
      "Access denied. Please access this content through the Digital Giant portal.",
      { status: 403, headers: { "Content-Type": "text/plain" } }
    );
  }

  // Verify token
  const tokenClaims = await verifyToken(dgtoken, TOKEN_SECRET);
  if (!tokenClaims) {
    return new Response(
      "Access token is invalid or has expired. Please return to the portal.",
      { status: 403, headers: { "Content-Type": "text/plain" } }
    );
  }

  // Build session cookie — covers all subsequent asset requests
  const sessionPayload = btoa(JSON.stringify({
    expires: Date.now() + SESSION_TTL_MS,
    tokenId: tokenClaims.tokenId,
    userId: tokenClaims.userId,
    moduleId: tokenClaims.moduleId,
  }));
  const cookieHeader = `${SESSION_COOKIE}=${sessionPayload}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;

  url.searchParams.delete("dgtoken");
  const cleanUrl = url.toString();

  const cleanRequest = new Request(cleanUrl, {
    headers: request.headers,
    method: request.method,
  });

  const response = await context.next(cleanRequest);

  const newResponse = new Response(response.body, response);
  newResponse.headers.append("Set-Cookie", cookieHeader);
  return newResponse;
}

async function verifyToken(tokenString, secret) {
  try {
    const base64 = tokenString.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
    const decoded = JSON.parse(atob(padded));
    const { tokenId, userId, moduleId, expiresAt, signature } = decoded;
    if (!tokenId || !userId || !moduleId || !expiresAt || !signature) return null;
    if (Date.now() > expiresAt) return null;
    const payload = `${tokenId}:${userId}:${moduleId}:${expiresAt}`;
    const encoder = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const sigBytes = hexToBytes(signature);
    const isValid = await crypto.subtle.verify("HMAC", cryptoKey, sigBytes, encoder.encode(payload));
    if (!isValid) return null;
    return { tokenId, userId, moduleId };
  } catch (e) {
    return null;
  }
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
