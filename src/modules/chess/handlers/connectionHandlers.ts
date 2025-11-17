import { Socket } from "socket.io";
import { gameManager } from "../../../services/chess/GameManager";
import { matchmakingService } from "../../../services/matchmaking/MatchmakingService";
import { roomService } from "../../../services/room/RoomService";
import { gamePersistenceService } from "../../../services/firebase/GamePersistenceService";
import logger from "../../../config/logger";

export const registerConnectionHandlers = (socket: Socket, chessNs: any) => {
  const uid = socket.data.uid as string;
  const username = socket.data.username as string || 'Player';

  // Handle active game on connection
  const handleActiveGameCheck = async () => {
    const activeGameCheck = await gameManager.checkActiveGame(uid);
    if (activeGameCheck.hasActiveGame) {
      logger.info(`Player ${uid} has active game: ${activeGameCheck.gameId}`);
      
      // Notify client about active game (client will decide to rejoin or clear)
      socket.emit("active-game-found", {
        gameId: activeGameCheck.gameId,
        gameData: activeGameCheck.gameData,
      });

      // Mark player as reconnected
      await gameManager.handlePlayerReconnect(activeGameCheck.gameId!, uid);
    }
  };

  // Check for active game on connection
  handleActiveGameCheck();

  // Handle clear-active-game event
  socket.on("clear-active-game", async (callback?: (response: { success: boolean }) => void) => {
    try {
      await gamePersistenceService.removeActiveGame(uid);
      logger.info(`Cleared active game for user ${uid}`);
      callback?.({ success: true });
    } catch (error) {
      logger.error(`Error clearing active game for ${uid}:`, error);
      callback?.({ success: false });
    }
  });

  // Disconnect
  socket.on("disconnect", async () => {
    logger.info(`Player ${uid} disconnected from chess namespace`);

    // Remove from matchmaking queue on disconnect
    matchmakingService.leaveQueue(uid);
    
    // Leave room on disconnect
    const result = roomService.leaveRoom(uid);
    if (result.success && result.roomId && !result.disbanded) {
      const room = roomService.getRoom(result.roomId);
      if (room) {
        chessNs.to(result.roomId).emit("player-left-room", {
          roomId: result.roomId,
          uid,
          room,
        });
      }
    }

    // Check if player is in an active game
    const activeGame = await gameManager.checkActiveGame(uid);
    if (activeGame.hasActiveGame && activeGame.gameId) {
      logger.info(`Player ${uid} disconnected from active game ${activeGame.gameId}`);
      
      // Notify opponent
      socket.to(activeGame.gameId).emit("player-disconnected", { uid });
      
      // Handle disconnection with timeout
      await gameManager.handlePlayerDisconnect(activeGame.gameId, uid);
    }
  });
};
