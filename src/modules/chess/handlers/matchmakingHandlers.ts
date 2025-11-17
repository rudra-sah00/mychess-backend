import { Socket } from "socket.io";
import { matchmakingService } from "../../../services/matchmaking/MatchmakingService";
import logger from "../../../config/logger";

interface JoinMatchmakingPayload {
  rating?: number;
  timeControl?: {
    initialTimeMs: number;
    incrementMs: number;
  };
}

export const registerMatchmakingHandlers = (socket: Socket) => {
  const uid = socket.data.uid as string;

  // Join matchmaking queue
  socket.on("join-matchmaking", async (payload: JoinMatchmakingPayload, callback?: (response: { success: boolean; queueSize?: number; position?: number | null; error?: string }) => void) => {
    try {
      const result = await matchmakingService.joinQueue({
        uid,
        socketId: socket.id,
        rating: payload.rating,
        timeControl: payload.timeControl,
        requestedAt: Date.now(),
      });

      if (!result.success) {
        callback?.({ success: false, error: result.error });
        return;
      }

      callback?.({
        success: true,
        queueSize: matchmakingService.getQueueSize(),
        position: matchmakingService.getPlayerPosition(uid),
      });

      logger.info(`Player ${uid} joined matchmaking queue`);
    } catch (error) {
      logger.error(`Join matchmaking error: ${error instanceof Error ? error.message : "Unknown error"}`);
      callback?.({ success: false, error: "Failed to join matchmaking" });
    }
  });

  // Leave matchmaking queue
  socket.on("leave-matchmaking", async (callback?: (response: { success: boolean; error?: string }) => void) => {
    try {
      const result = await matchmakingService.leaveQueue(uid);
      callback?.({ success: result.success });
      logger.info(`Player ${uid} left matchmaking queue`);
    } catch (error) {
      logger.error(`Leave matchmaking error: ${error instanceof Error ? error.message : "Unknown error"}`);
      callback?.({ success: false, error: "Failed to leave matchmaking" });
    }
  });
};
