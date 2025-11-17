import { Socket } from "socket.io";
import { firebaseAdmin } from "../services/firebase/firebaseAdmin";
import logger from "../config/logger";

/**
 * Socket.IO authentication middleware
 * Verifies session cookie or Firebase ID token and attaches uid to socket.data
 */
export async function socketAuthMiddleware(socket: Socket, next: (err?: Error) => void): Promise<void> {
  try {
    const token = socket.handshake.auth.token as string | undefined;
    const sessionCookie = socket.handshake.headers.cookie?.split("; ").find((c) => c.startsWith("session="))?.split("=")[1];

    let uid: string | undefined;

    // Try session cookie first (preferred for web clients)
    if (sessionCookie) {
      try {
        const decodedClaims = await firebaseAdmin.verifySessionCookie(sessionCookie);
        uid = decodedClaims.uid;
      } catch (error) {
        logger.warn(`Invalid session cookie: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

    // Fallback to ID token (for mobile clients or if session cookie invalid)
    if (!uid && token) {
      try {
        const decodedToken = await firebaseAdmin.verifyIdToken(token);
        uid = decodedToken.uid;
      } catch (error) {
        logger.warn(`Invalid ID token: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

    if (!uid) {
      logger.warn(`Socket authentication failed: ${socket.id}`);
      return next(new Error("Authentication required"));
    }

    // Attach uid to socket data for use in event handlers
    socket.data.uid = uid;
    
    // Extract username from query params if available
    const username = socket.handshake.query.username as string | undefined;
    socket.data.username = username || 'Player';
    
    logger.debug(`Socket authenticated: uid=${uid}, username=${socket.data.username}`);
    
    next();
  } catch (error) {
    logger.error(`Socket authentication error: ${error instanceof Error ? error.message : "Unknown error"}`);
    next(new Error("Authentication failed"));
  }
}
