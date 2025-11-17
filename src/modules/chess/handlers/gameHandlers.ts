import { Socket } from "socket.io";
import { gameManager } from "../../../services/chess/GameManager";
import logger from "../../../config/logger";

interface JoinGamePayload {
  gameId: string;
}

interface MakeMovePayload {
  gameId: string;
  from: string;
  to: string;
  promotion?: "q" | "r" | "b" | "n";
}

interface DrawOfferPayload {
  gameId: string;
}

interface DrawResponsePayload {
  gameId: string;
  accept: boolean;
}

interface ResignPayload {
  gameId: string;
}

export const registerGameHandlers = (socket: Socket, chessNs: any) => {
  const uid = socket.data.uid as string;

  // Join game
  socket.on("join-game", async (payload: JoinGamePayload, callback?: (response: { success: boolean; gameState?: unknown; error?: string }) => void) => {
    try {
      const { gameId } = payload;

      // Load game
      const game = await gameManager.loadGame(gameId);
      if (!game) {
        logger.warn(`Join game failed: game ${gameId} not found`);
        callback?.({ success: false, error: "Game not found" });
        return;
      }

      // Verify player
      const isWhite = game.whitePlayer.uid === uid;
      const isBlack = game.blackPlayer.uid === uid;
      if (!isWhite && !isBlack) {
        logger.warn(`Join game failed: ${uid} not a player in game ${gameId}`);
        callback?.({ success: false, error: "You are not a player in this game" });
        return;
      }

      // Join room
      await socket.join(gameId);

      // Update socket ID
      await gameManager.updateSocketId(gameId, uid, socket.id);

      // Load move history from database
      const moves = await gameManager.getMoveHistory(gameId);

      // Send full game state
      callback?.({
        success: true,
        gameState: {
          gameId: game.gameId,
          fen: game.fen,
          pgn: game.pgn,
          turn: game.turn,
          status: game.status,
          winner: game.winner,
          endReason: game.endReason,
          whitePlayer: game.whitePlayer,
          blackPlayer: game.blackPlayer,
          clockState: game.clockState,
          drawOffer: game.drawOffer,
          moves: moves,
        },
      });

      // Notify opponent
      socket.to(gameId).emit("player-reconnected", { color: isWhite ? "white" : "black" });

      logger.info(`Player ${uid} joined game ${gameId} as ${isWhite ? "white" : "black"}`);
    } catch (error) {
      logger.error(`Join game error: ${error instanceof Error ? error.message : "Unknown error"}`);
      callback?.({ success: false, error: "Failed to join game" });
    }
  });

  // Make move
  socket.on("make-move", async (payload: MakeMovePayload, callback?: (response: { success: boolean; error?: string }) => void) => {
    try {
      const { gameId, from, to, promotion } = payload;

      logger.info(`Make-move request: gameId=${gameId}, uid=${uid}, from=${from}, to=${to}, promotion=${promotion}`);

      // Validate inputs
      if (!gameId || !from || !to) {
        callback?.({ success: false, error: "Missing required fields" });
        return;
      }

      if (!uid) {
        logger.error("Make-move error: uid is undefined");
        callback?.({ success: false, error: "User not authenticated" });
        return;
      }

      // Apply move
      const result = await gameManager.applyMove(gameId, uid, from, to, promotion);

      if (!result.success) {
        logger.warn(`Move rejected in game ${gameId} by ${uid}: ${result.error} (from: ${from}, to: ${to})`);
        callback?.({ success: false, error: result.error });
        return;
      }

      // Get updated game state
      const game = gameManager.getGame(gameId);
      if (!game) {
        callback?.({ success: false, error: "Game not found" });
        return;
      }

      // Acknowledge to sender
      callback?.({ success: true });

      // Broadcast move to all players
      chessNs.to(gameId).emit("move-made", {
        gameId,
        from,
        to,
        promotion,
        san: result.move!.san,
        move: result.move,
        fen: game.fen,
        currentTurn: game.turn === 'w' ? 'white' : 'black',
        gameStatus: game.status,
        clockState: game.clockState,
        isCheck: result.move?.san.includes('+') || false,
        isCheckmate: result.isGameOver && result.winner !== 'draw',
        isDraw: result.winner === 'draw',
      });

      // Check for game over
      if (result.isGameOver) {
        chessNs.to(gameId).emit("game-over", {
          winner: result.winner,
          reason: result.reason,
          finalFen: game.fen,
          pgn: game.pgn,
        });
        logger.info(`Game ${gameId} ended: ${result.winner} (${result.reason})`);
        
        // Clean up bot if exists
        const { botManager } = await import('../botManager');
        const bot = botManager.getBot(gameId);
        if (bot) {
          botManager.removeBot(gameId);
        }
        
        // Remove all sockets from game room after game ends
        const socketsInRoom = await chessNs.in(gameId).fetchSockets();
        for (const sock of socketsInRoom) {
          sock.leave(gameId);
        }
        logger.info(`Removed ${socketsInRoom.length} sockets from game room ${gameId}`);
      } else {
        // Check if it's bot's turn next
        const nextPlayer = game.turn === 'w' ? game.whitePlayer : game.blackPlayer;
        if (nextPlayer.uid === 'BOT') {
          // Schedule bot move after a short delay - use dynamic import to avoid circular dependency
          setTimeout(async () => {
            try {
              const botHandlers = await import('./botHandlers');
              await botHandlers.makeBotMove(gameId, chessNs);
            } catch (err) {
              logger.error(`Failed to import botHandlers: ${err}`);
            }
          }, 800);
        }
      }

      logger.info(`Move made in game ${gameId}: ${from} to ${to} by ${uid}`);
    } catch (error) {
      logger.error(`Make move error in game ${payload.gameId}: ${error instanceof Error ? error.message : "Unknown error"}`);
      logger.error(`Error stack: ${error instanceof Error ? error.stack : "No stack trace"}`);
      callback?.({ success: false, error: "Failed to make move" });
    }
  });

  // Offer draw
  socket.on("offer-draw", async (payload: DrawOfferPayload, callback?: (response: { success: boolean; error?: string }) => void) => {
    try {
      const { gameId } = payload;

      const result = await gameManager.offerDraw(gameId, uid);

      if (!result.success) {
        callback?.({ success: false, error: result.error });
        return;
      }

      callback?.({ success: true });

      // Notify opponent
      socket.to(gameId).emit("draw-offered", {
        from: uid,
      });

      logger.info(`Draw offered by ${uid} in game ${gameId}`);
    } catch (error) {
      logger.error(`Offer draw error: ${error instanceof Error ? error.message : "Unknown error"}`);
      callback?.({ success: false, error: "Failed to offer draw" });
    }
  });

  // Respond to draw offer
  socket.on("draw-response", async (payload: DrawResponsePayload, callback?: (response: { success: boolean; error?: string }) => void) => {
    try {
      const { gameId, accept } = payload;

      const result = await gameManager.respondToDrawOffer(gameId, uid, accept);

      if (!result.success) {
        callback?.({ success: false, error: result.error });
        return;
      }

      callback?.({ success: true });

      if (accept && "isGameOver" in result && result.isGameOver) {
        // Broadcast game over
        const game = gameManager.getGame(gameId);
        chessNs.to(gameId).emit("game-over", {
          winner: result.winner,
          reason: result.reason,
          finalFen: game?.fen,
          pgn: game?.pgn,
        });
        logger.info(`Game ${gameId} ended by draw agreement`);
        
        // Remove all sockets from game room after draw accepted
        const socketsInRoom = await chessNs.in(gameId).fetchSockets();
        for (const sock of socketsInRoom) {
          sock.leave(gameId);
        }
        logger.info(`Removed ${socketsInRoom.length} sockets from game room ${gameId}`);
      } else {
        // Notify draw declined
        socket.to(gameId).emit("draw-declined", {});
        logger.info(`Draw declined by ${uid} in game ${gameId}`);
      }
    } catch (error) {
      logger.error(`Draw response error: ${error instanceof Error ? error.message : "Unknown error"}`);
      callback?.({ success: false, error: "Failed to respond to draw" });
    }
  });

  // Resign
  socket.on("resign", async (payload: ResignPayload, callback?: (response: { success: boolean; error?: string }) => void) => {
    try {
      const { gameId } = payload;

      const result = await gameManager.resign(gameId, uid);

      if (!result.success) {
        callback?.({ success: false, error: result.error });
        return;
      }

      callback?.({ success: true });

      // Broadcast game over
      const game = gameManager.getGame(gameId);
      chessNs.to(gameId).emit("game-over", {
        winner: result.winner,
        reason: result.reason,
        finalFen: game?.fen,
        pgn: game?.pgn,
      });

      logger.info(`Player ${uid} resigned in game ${gameId}`);
      
      // Remove all sockets from game room after resignation
      const socketsInRoom = await chessNs.in(gameId).fetchSockets();
      for (const sock of socketsInRoom) {
        sock.leave(gameId);
      }
      logger.info(`Removed ${socketsInRoom.length} sockets from game room ${gameId}`);
    } catch (error) {
      logger.error(`Resign error: ${error instanceof Error ? error.message : "Unknown error"}`);
      callback?.({ success: false, error: "Failed to resign" });
    }
  });

  // Wait for opponent (cancel disconnect timer)
  socket.on("wait-for-opponent", async (payload: { gameId: string }, callback?: (response: { success: boolean; error?: string }) => void) => {
    try {
      const { gameId } = payload;
      
      await gameManager.cancelWaitTimer(gameId, uid);
      
      callback?.({ success: true });
      
      logger.info(`Player ${uid} chose to wait for opponent in game ${gameId}`);
    } catch (error) {
      logger.error(`Wait for opponent error: ${error instanceof Error ? error.message : "Unknown error"}`);
      callback?.({ success: false, error: "Failed to set wait state" });
    }
  });
};
