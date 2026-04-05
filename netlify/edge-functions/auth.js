// Netlify Edge Function: auth.js
// Validates Digital Giant portal tokens before serving content.

const SESSION_COOKIE = "dg_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

export default async function handler(request, context) {
  const url = new URL(request.url);

  // Allow static assets through without auth
  if (url.pathname.startsWith("/assets/")) {
    return context.next();
  }

  const TOKEN_SECRET = Deno.env.get("DG_TOKEN_SECRET");
  if (!TOKEN_SECRET) {
    console.error("DG_TOKEN_SECRET not configured");
    return new Response("Server configuration error.", { status: 500 });
  }

  // Check for existing valid session cookie first
  const cookies = request.headers.get("cookie") || "";
  const sessionMatch = cookies.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (sessionMatch) {
    try {
      const sessionData = JSON.parse(atob(sessionMatch[1]));
      if (sessionData.expires > Date.now()) {
        return context.next();
      }
    } catch (e) {
      console.error("Session cookie parse error:", e.message);
    }
  }

  // Check for dgtoken query parameter
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
    console.error("Token verification failed for token:", dgtoken.substring(0, 20) + "...");
    return new Response(
      "Access token is invalid or has expired. Please return to the portal.",
      { status: 403, headers: { "Content-Type": "text/plain" } }
    );
  }

  // Valid token — set session cookie and redirect to clean URL
  const sessionPayload = btoa(JSON.stringify({
    expires: Date.now() + SESSION_TTL_MS,
    tokenId: tokenClaims.tokenId,
    userId: tokenClaims.userId,
    moduleId: tokenClaims.moduleId,
  }));

  url.searchParams.delete("dgtoken");
  const cleanUrl = url.toString();

  return new Response(null, {
    status: 302,
    headers: {
      Location: cleanUrl,
      "Set-Cookie": `${SESSION_COOKIE}=${sessionPayload}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    },
  });
}

async function verifyToken(tokenString, secret) {
  try {
    // base64url -> base64 standard
    const base64 = tokenString.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
    const json = atob(padded);
    const decoded = JSON.parse(json);

    const { tokenId, userId, moduleId, expiresAt, signature } = decoded;

    if (!tokenId || !userId || !moduleId || !expiresAt || !signature) {
      console.error("Token missing required fields");
      return null;
    }

    if (Date.now() > expiresAt) {
      console.error("Token expired at:", new Date(expiresAt).toISOString());
      return null;
    }

    const payload = `${tokenId}:${userId}:${moduleId}:${expiresAt}`;

    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(payload);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const sigBytes = hexToBytes(signature);
    const isValid = await crypto.subtle.verify("HMAC", cryptoKey, sigBytes, messageData);

    if (!isValid) {
      console.error("Token signature invalid");
      return null;
    }

    return { tokenId, userId, moduleId };
  } catch (e) {
    console.error("Token decode error:", e.message);
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
