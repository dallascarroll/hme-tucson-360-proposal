// Netlify Edge Function: auth.js - DEBUG VERSION

export default async function handler(request, context) {
  const url = new URL(request.url);
  const dgtoken = url.searchParams.get("dgtoken");
  const cookies = request.headers.get("cookie") || "";
  
  console.log("AUTH edge function invoked:", url.pathname, "dgtoken present:", !!dgtoken);

  // Allow static assets
  if (url.pathname.startsWith("/assets/")) {
    console.log("Allowing asset through");
    return context.next();
  }

  const TOKEN_SECRET = Deno.env.get("DG_TOKEN_SECRET");
  console.log("TOKEN_SECRET present:", !!TOKEN_SECRET);

  // Check session cookie
  const sessionMatch = cookies.match(/dg_session=([^;]+)/);
  if (sessionMatch) {
    try {
      const sessionData = JSON.parse(atob(sessionMatch[1]));
      if (sessionData.expires > Date.now()) {
        console.log("Valid session cookie found, allowing through");
        return context.next();
      }
      console.log("Session cookie expired");
    } catch (e) {
      console.error("Session parse error:", e.message);
    }
  }

  if (!dgtoken) {
    console.log("No dgtoken, blocking");
    return new Response(
      "Access denied. Please access this content through the Digital Giant portal.",
      { status: 403, headers: { "Content-Type": "text/plain" } }
    );
  }

  console.log("dgtoken present, attempting verification. First 30 chars:", dgtoken.substring(0, 30));

  if (!TOKEN_SECRET) {
    console.error("No TOKEN_SECRET configured!");
    return new Response("Server configuration error.", { status: 500 });
  }

  const tokenClaims = await verifyToken(dgtoken, TOKEN_SECRET);
  console.log("Token verification result:", tokenClaims ? "VALID" : "INVALID");

  if (!tokenClaims) {
    return new Response(
      "Access token is invalid or has expired. Please return to the portal.",
      { status: 403, headers: { "Content-Type": "text/plain" } }
    );
  }

  // Valid — set session cookie and redirect to clean URL
  const sessionPayload = btoa(JSON.stringify({
    expires: Date.now() + (8 * 60 * 60 * 1000),
    tokenId: tokenClaims.tokenId,
  }));

  url.searchParams.delete("dgtoken");
  const cleanUrl = url.toString();
  console.log("Token valid! Redirecting to:", cleanUrl);

  return new Response(null, {
    status: 302,
    headers: {
      Location: cleanUrl,
      "Set-Cookie": `dg_session=${sessionPayload}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`,
    },
  });
}

async function verifyToken(tokenString, secret) {
  try {
    const base64 = tokenString.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
    
    let json;
    try {
      json = atob(padded);
    } catch(e) {
      console.error("atob failed:", e.message, "padded length:", padded.length);
      return null;
    }
    
    let decoded;
    try {
      decoded = JSON.parse(json);
    } catch(e) {
      console.error("JSON.parse failed:", e.message);
      return null;
    }

    const { tokenId, userId, moduleId, expiresAt, signature } = decoded;
    console.log("Decoded token fields present:", { tokenId: !!tokenId, userId: !!userId, moduleId: !!moduleId, expiresAt, signature: !!signature });

    if (!tokenId || !userId || !moduleId || !expiresAt || !signature) {
      console.error("Missing token fields");
      return null;
    }

    const now = Date.now();
    console.log("Token expiry check: now=", now, "expiresAt=", expiresAt, "expired=", now > expiresAt);
    if (now > expiresAt) {
      console.error("Token expired");
      return null;
    }

    const payload = `${tokenId}:${userId}:${moduleId}:${expiresAt}`;
    const encoder = new TextEncoder();
    
    const cryptoKey = await crypto.subtle.importKey(
      "raw", encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false, ["verify"]
    );

    const sigBytes = hexToBytes(signature);
    const isValid = await crypto.subtle.verify("HMAC", cryptoKey, sigBytes, encoder.encode(payload));
    console.log("HMAC signature valid:", isValid);

    if (!isValid) return null;
    return { tokenId, userId, moduleId };
  } catch (e) {
    console.error("verifyToken exception:", e.message);
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
