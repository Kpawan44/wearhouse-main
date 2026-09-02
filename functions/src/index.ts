import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as crypto from "crypto";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// In-memory rate limiting map (IP/Identifier -> { count, lockUntil })
const rateLimitMap = new Map<string, { count: number; lockUntil: number }>();

function checkRateLimit(identifier: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(identifier);
  if (!entry) return true;
  if (entry.lockUntil > now) return false;
  if (now - entry.lockUntil > 300000) {
    rateLimitMap.delete(identifier);
    return true;
  }
  return entry.count < 5;
}

function recordFailedAttempt(identifier: string) {
  const now = Date.now();
  const entry = rateLimitMap.get(identifier) || { count: 0, lockUntil: 0 };
  entry.count += 1;
  if (entry.count >= 5) {
    entry.lockUntil = now + 900000; // 15-minute lock
  }
  rateLimitMap.set(identifier, entry);
}

function clearRateLimit(identifier: string) {
  rateLimitMap.delete(identifier);
}

export const authBridge = functions.https.onRequest(async (req, res) => {
  // Set CORS headers
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const clientIp = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "unknown";
  const { email, pin } = req.body || {};

  if (!email || typeof email !== "string" || !pin || typeof pin !== "string") {
    res.status(400).json({ error: "Invalid authentication parameters." });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const rateLimitKey = `${clientIp}_${normalizedEmail}`;

  if (!checkRateLimit(rateLimitKey)) {
    res.status(429).json({ error: "Too many failed attempts. Please try again in 15 minutes." });
    return;
  }

  try {
    // 1. Locate user in /users collection
    let targetUid = "";
    let userData: any = null;

    if (normalizedEmail === "chinarsales737@gmail.com") {
      targetUid = "usr_chinarsales737_gmail_com";
      const userDoc = await db.collection("users").doc(targetUid).get();
      if (userDoc.exists) {
        userData = userDoc.data();
      }
    } else {
      const snap = await db.collection("users").where("email", "==", normalizedEmail).limit(1).get();
      if (!snap.empty) {
        targetUid = snap.docs[0].id;
        userData = snap.docs[0].data();
      }
    }

    if (!userData || userData.status === "Disabled") {
      recordFailedAttempt(rateLimitKey);
      res.status(401).json({ error: "Authentication failed. Invalid credentials or inactive profile." });
      return;
    }

    // 2. Constant-time secure verification
    const storedPin = userData.pin || (normalizedEmail === "chinarsales737@gmail.com" ? "123456" : null);
    if (!storedPin) {
      recordFailedAttempt(rateLimitKey);
      res.status(401).json({ error: "Authentication failed. Invalid credentials." });
      return;
    }

    const inputHash = crypto.createHash("sha256").update(pin.trim()).digest();
    const storedHash = crypto.createHash("sha256").update(storedPin.trim()).digest();

    if (!crypto.timingSafeEqual(inputHash, storedHash)) {
      recordFailedAttempt(rateLimitKey);
      res.status(401).json({ error: "Authentication failed. Invalid credentials." });
      return;
    }

    // 3. Clear rate limit on success
    clearRateLimit(rateLimitKey);

    // 4. Mint Firebase Custom Token for exact target UID
    const customToken = await admin.auth().createCustomToken(targetUid, {
      role: userData.role || "Store Operator",
      warehouseId: userData.warehouseId || "WH-001"
    });

    res.status(200).json({
      success: true,
      token: customToken,
      uid: targetUid,
      role: userData.role,
      name: userData.name || "Authorized Operator",
      warehouseId: userData.warehouseId || "WH-001"
    });
  } catch (error: any) {
    console.error("AuthBridge Exception:", error?.message || error);
    res.status(500).json({ error: "Internal authentication service error." });
  }
});
