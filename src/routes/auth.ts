import { Router, Request, Response } from "express";
import {
  verifyIdToken,
  createSessionCookie,
  verifySessionCookie,
  revokeRefreshTokens,
} from "../services/firebaseAdmin";
import logger from "../config/logger";

const router = Router();

const SESSION_COOKIE_NAME = "session";
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// POST /api/auth/google - Create session cookie from ID token
router.post("/google", async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : undefined;

  const idToken = (req.body?.idToken as string | undefined) || bearerToken;

  if (!idToken) {
    return res.status(400).json({ error: "idToken is required" });
  }

  try {
    const decodedToken = await verifyIdToken(idToken);
    const sessionCookie = await createSessionCookie(idToken, MAX_AGE_MS);

    res.cookie(SESSION_COOKIE_NAME, sessionCookie, {
      maxAge: MAX_AGE_MS,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });

    logger.info(`User signed in: ${decodedToken.uid}`);

    return res.json({
      success: true,
      uid: decodedToken.uid,
      expiresIn: MAX_AGE_MS,
    });
  } catch (error) {
    logger.error("Sign-in failed", { error: error instanceof Error ? error.message : "unknown" });
    return res.status(401).json({
      error: error instanceof Error ? error.message : "invalid token",
    });
  }
});

// POST /api/auth/refresh - Extend session cookie
router.post("/refresh", async (req: Request, res: Response) => {
  const sessionCookie = req.cookies?.[SESSION_COOKIE_NAME];

  if (!sessionCookie) {
    return res.status(401).json({ error: "no session found" });
  }

  try {
    const decodedClaims = await verifySessionCookie(sessionCookie);
    
    // Create new session cookie with fresh expiry
    const newSessionCookie = await createSessionCookie(
      sessionCookie,
      MAX_AGE_MS
    );

    res.cookie(SESSION_COOKIE_NAME, newSessionCookie, {
      maxAge: MAX_AGE_MS,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });

    logger.info(`Session refreshed: ${decodedClaims.uid}`);

    return res.json({
      success: true,
      uid: decodedClaims.uid,
      expiresIn: MAX_AGE_MS,
    });
  } catch (error) {
    logger.warn("Session refresh failed", { error: error instanceof Error ? error.message : "unknown" });
    res.clearCookie(SESSION_COOKIE_NAME);
    return res.status(401).json({
      error: error instanceof Error ? error.message : "invalid session",
    });
  }
});

// POST /api/auth/logout - Clear session and revoke tokens
router.post("/logout", async (req: Request, res: Response) => {
  const sessionCookie = req.cookies?.[SESSION_COOKIE_NAME];

  if (sessionCookie) {
    try {
      const decodedClaims = await verifySessionCookie(sessionCookie);
      await revokeRefreshTokens(decodedClaims.uid);
      logger.info(`User logged out: ${decodedClaims.uid}`);
    } catch (error) {
      logger.warn("Logout verification failed, clearing cookie anyway");
    }
  }

  res.clearCookie(SESSION_COOKIE_NAME);
  return res.json({ success: true });
});

// GET /api/auth/status - Check current session status
router.get("/status", async (req: Request, res: Response) => {
  const sessionCookie = req.cookies?.[SESSION_COOKIE_NAME];

  if (!sessionCookie) {
    return res.json({ authenticated: false });
  }

  try {
    const decodedClaims = await verifySessionCookie(sessionCookie);
    return res.json({
      authenticated: true,
      uid: decodedClaims.uid,
      email: decodedClaims.email,
      expiresAt: decodedClaims.exp ? decodedClaims.exp * 1000 : null,
    });
  } catch (error) {
    res.clearCookie(SESSION_COOKIE_NAME);
    return res.json({ authenticated: false });
  }
});

export default router;
