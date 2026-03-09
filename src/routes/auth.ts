import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authService } from "../services/auth/authService";
import logger from "../config/logger";

const router = Router();
const prisma = new PrismaClient();

const SESSION_COOKIE_NAME = "session";
// Ensure ms conversion, authService expires assumes string "14d", for cookie we need MS.
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// POST /api/auth/register
router.post("/register", async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password || typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Username and password are required" });
  }

  try {
    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (existingUser) {
      return res.status(409).json({ error: "Username already exists" });
    }

    const passwordHash = await authService.hashPassword(password);
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
      },
    });

    const token = authService.generateToken({ uid: user.id, email: user.username });

    res.cookie(SESSION_COOKIE_NAME, token, {
      maxAge: MAX_AGE_MS,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });

    logger.info(`New user registered: ${user.id} (${user.username})`);

    return res.status(201).json({
      success: true,
      uid: user.id,
      username: user.username,
      expiresIn: MAX_AGE_MS,
    });
  } catch (error) {
    logger.error("Registration failed", { error: error instanceof Error ? error.message : "unknown" });
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/login
router.post("/login", async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  try {
    const user = await prisma.user.findUnique({ where: { username } });

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isValidPassword = await authService.comparePassword(password, user.passwordHash);

    if (!isValidPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = authService.generateToken({ uid: user.id, email: user.username });

    res.cookie(SESSION_COOKIE_NAME, token, {
      maxAge: MAX_AGE_MS,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });

    logger.info(`User logged in: ${user.id}`);

    return res.json({
      success: true,
      uid: user.id,
      username: user.username,
      expiresIn: MAX_AGE_MS,
    });
  } catch (error) {
    logger.error("Login failed", { error: error instanceof Error ? error.message : "unknown" });
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/refresh - Not strictly needed for simple JWT, but kept to prevent breaking frontend
router.post("/refresh", async (req: Request, res: Response) => {
  const sessionCookie = req.cookies?.[SESSION_COOKIE_NAME];

  if (!sessionCookie) {
    return res.status(401).json({ error: "no session found" });
  }

  try {
    const decodedPayload = authService.verifyToken(sessionCookie);

    // Create new token to refresh expiry
    const newToken = authService.generateToken({ uid: decodedPayload.uid, email: decodedPayload.email });

    res.cookie(SESSION_COOKIE_NAME, newToken, {
      maxAge: MAX_AGE_MS,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });

    logger.info(`Session refreshed: ${decodedPayload.uid}`);

    return res.json({
      success: true,
      uid: decodedPayload.uid,
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

// POST /api/auth/logout - Clear session cookie
router.post("/logout", async (req: Request, res: Response) => {
  const sessionCookie = req.cookies?.[SESSION_COOKIE_NAME];

  if (sessionCookie) {
    try {
      const decodedPayload = authService.verifyToken(sessionCookie);
      logger.info(`User logged out: ${decodedPayload.uid}`);
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
    const decodedPayload = authService.verifyToken(sessionCookie);
    const user = await prisma.user.findUnique({ where: { id: decodedPayload.uid } });

    if (!user) {
      res.clearCookie(SESSION_COOKIE_NAME);
      return res.json({ authenticated: false });
    }

    return res.json({
      authenticated: true,
      uid: user.id,
      username: user.username,
      rating: user.rating,
    });
  } catch (error) {
    res.clearCookie(SESSION_COOKIE_NAME);
    return res.json({ authenticated: false });
  }
});

export default router;
