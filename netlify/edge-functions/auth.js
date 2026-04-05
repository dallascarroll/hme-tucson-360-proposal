// Netlify Edge Function: auth.js
// Validates Digital Giant portal tokens before serving content.
// Runs on every request to digitalgiant-sandbox01.com.

const SESSION_COOKIE = "dg_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

export default async function handler(request, context) {
  const url = new URL(request.url);

  // Allow static assets through without auth check
  // (images, webp frames, etc. are protected implicitly because
  // the session cookie is required before the page loads)
  const isAsset = url.pathname.startsWith("/assets/");
  if (isAsset) {
    return context.next();
  }

  const TOKEN_SECRET = Deno.env.get("DG_TOKEN_SECRET");
  if (!TOKEN_SECRET) {
    console.error("DG_TOKEN_SECRET not set");
    return new Response("Server configuration error.", { status: 500 });
  }

  // Check for existing valid session cookie
  const cookies = request.headers.get("cookie") || "";
  const sessionMatch = cookies.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));

  if (sessionMatch) {
    try {
      const sessionData = JSON.parse(atob(sessionMatch[1]));
      if (sessionData.expires > Date.now()) {
        // Valid session — serve the content
        return context.next();
      }
    } catch {
      // Invalid cookie — fall through to token check
    }
  }

  // Check for a dgtoken query parameter (first access from portal)
  const dgtoken = url.searchParams.get("dgtoken");

  if (!dgtoken) {
    return new Response(
      "Access denied. Please access this content through the Digital Giant portal.",
      {
        status: 403,
        headers: { "Content-Type": "text/plain" },
      }
    );
  }

  // Verify the token signature and expiry locally
  const tokenValid = await verifyToken(dgtoken, TOKEN_SECRET);

  if (!tokenValid) {
    return new Response(
      "Access token is invalid or has expired. Please return to the portal.",
      {
        status: 403,
        headers: { "Content-Type": "text/plain" },
      }
    );
  }

  // Token is valid — issue a session cookie and strip the token from the URL
  const sessionPayload = btoa(
    JSON.stringify({
      expires: Date.now() + SESSION_TTL_MS,
      tokenId: tokenValid.tokenId,
    })
  );

  // Redirect to clean URL (without dgtoken param) with session cookie set
  url.searchParams.delete("dgtoken");
  const cleanUrl = url.toString();

  return new Response(null, {
    status: 302,
    headers: {
      Location: cleanUrl,
      "Set-Cookie": `${SESSION_COOKIE}=${sessionPayload}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`,
    },
  });
}

// Verify HMAC-SHA256 signed token
async function verifyToken(tokenString, secret) {
  try {
    const decoded = JSON.parse(atob(tokenString.replace(/-/g, "+").replace(/_/g, "/")));
    const { tokenId, userId, moduleId, expiresAt, signature } = decoded;

    if (!tokenId || !userId || !moduleId || !expiresAt || !signature) return null;
    if (Date.now() > expiresAt) return null;

    const payload = `${tokenId}:${userId}:${moduleId}:${expiresAt}`;

    // Use Web Crypto API (available in Deno/Edge runtime)
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

    if (!isValid) return null;

    return { tokenId, userId, moduleId };
  } catch (e) {
    console.error("Token verification error:", e);
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
