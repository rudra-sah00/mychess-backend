import { Server, Socket } from "socket.io";
import { socketAuthMiddleware } from "../../middleware/socketAuth";
import { gameManager } from "../../services/chess/GameManager";
import { matchmakingService } from "../../services/matchmaking/MatchmakingService";
import { roomService } from "../../services/room/RoomService";
import { BotManager, BotDifficulty } from "../../services/bot/BotService";
import logger from "../../config/logger";

const botManager = new BotManager();

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

interface JoinMatchmakingPayload {
  rating?: number;
  timeControl?: {
    initialTimeMs: number;
    incrementMs: number;
  };
}

interface CreateRoomPayload {
  name?: string;
  isPrivate?: boolean;
  password?: string;
  timeControl?: {
    initialTimeMs: number;
    incrementMs: number;
  };
}

interface JoinRoomPayload {
  roomId: string;
  password?: string;
}

interface SetReadyPayload {
  isReady: boolean;
}

interface PlayWithBotPayload {
  difficulty: BotDifficulty;
  timeControl?: {
    initialTimeMs: number;
    incrementMs: number;
  };
}

export const registerChessNamespace = (io: Server) => {
  const chessNs = io.of("/chess");

  // Apply authentication middleware
  chessNs.use(socketAuthMiddleware);

  // Set up clock update callback
  gameManager.setClockUpdateCallback((gameId, data) => {
    chessNs.to(gameId).emit("clock-update", data);
  });

  // Set up matchmaking callback
  matchmakingService.setMatchFoundCallback((player1Uid, player2Uid, gameId) => {
    // Notify both players that a match was found
    const game = gameManager.getGame(gameId);
    if (!game) return;

    const player1SocketId = game.whitePlayer.uid === player1Uid ? game.whitePlayer.socketId : game.blackPlayer.socketId;
    const player2SocketId = game.whitePlayer.uid === player2Uid ? game.whitePlayer.socketId : game.blackPlayer.socketId;

    if (player1SocketId) {
      chessNs.to(player1SocketId).emit("match-found", {
        gameId,
        color: game.whitePlayer.uid === player1Uid ? "white" : "black",
        opponent: game.whitePlayer.uid === player1Uid ? game.blackPlayer : game.whitePlayer,
      });
    }

    if (player2SocketId) {
      chessNs.to(player2SocketId).emit("match-found", {
        gameId,
        color: game.whitePlayer.uid === player2Uid ? "white" : "black",
        opponent: game.whitePlayer.uid === player2Uid ? game.blackPlayer : game.whitePlayer,
      });
    }

    logger.info(`Match-found notifications sent for game ${gameId}`);
  });

  chessNs.on("connection", (socket: Socket) => {
    const uid = socket.data.uid as string;
    logger.info(`Socket connected to /chess namespace: ${socket.id} (uid: ${uid})`);

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

        // Validate inputs
        if (!gameId || !from || !to) {
          callback?.({ success: false, error: "Missing required fields" });
          return;
        }

        // Apply move
        const result = await gameManager.applyMove(gameId, uid, from, to, promotion);

        if (!result.success) {
          logger.warn(`Move rejected in game ${gameId}: ${result.error}`);
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
          from,
          to,
          promotion,
          san: result.move!.san,
          fen: game.fen,
          turn: game.turn,
          clockState: game.clockState,
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
          if (botManager.getBot(gameId)) {
            botManager.removeBot(gameId);
          }
        } else {
          // Check if it's bot's turn next
          const nextPlayer = game.turn === 'w' ? game.whitePlayer : game.blackPlayer;
          if (nextPlayer.uid === 'BOT') {
            // Schedule bot move after a short delay
            setTimeout(async () => {
              await makeBotMove(gameId, chessNs);
            }, 800);
          }
        }

        logger.info(`Move made in game ${gameId}: ${from} to ${to} by ${uid}`);
      } catch (error) {
        logger.error(`Make move error: ${error instanceof Error ? error.message : "Unknown error"}`);
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
      } catch (error) {
        logger.error(`Resign error: ${error instanceof Error ? error.message : "Unknown error"}`);
        callback?.({ success: false, error: "Failed to resign" });
      }
    });

    // Disconnect
    socket.on("disconnect", () => {
      logger.info(`Socket disconnected from /chess namespace: ${socket.id} (uid: ${uid})`);
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
    });

    // Create room
    socket.on("create-room", (payload: CreateRoomPayload, callback?: (response: { success: boolean; room?: unknown; error?: string }) => void) => {
      try {
        const result = roomService.createRoom(uid, socket.id, payload);

        if (!result.success) {
          callback?.({ success: false, error: result.error });
          return;
        }

        // Join the socket to the room
        socket.join(result.room!.roomId);

        callback?.({ success: true, room: result.room });
        logger.info(`Room created: ${result.room!.roomId} by ${uid}`);
      } catch (error) {
        logger.error(`Create room error: ${error instanceof Error ? error.message : "Unknown error"}`);
        callback?.({ success: false, error: "Failed to create room" });
      }
    });

    // Join room
    socket.on("join-room", (payload: JoinRoomPayload, callback?: (response: { success: boolean; room?: unknown; error?: string }) => void) => {
      try {
        const result = roomService.joinRoom(uid, socket.id, payload.roomId, payload.password);

        if (!result.success) {
          callback?.({ success: false, error: result.error });
          return;
        }

        // Join the socket to the room
        socket.join(result.room!.roomId);

        // Notify other players in the room
        socket.to(result.room!.roomId).emit("player-joined-room", {
          roomId: result.room!.roomId,
          player: {
            uid,
            joinedAt: Date.now(),
            isReady: false,
          },
          room: result.room,
        });

        callback?.({ success: true, room: result.room });
        logger.info(`Player ${uid} joined room ${result.room!.roomId}`);
      } catch (error) {
        logger.error(`Join room error: ${error instanceof Error ? error.message : "Unknown error"}`);
        callback?.({ success: false, error: "Failed to join room" });
      }
    });

    // Leave room
    socket.on("leave-room", (callback?: (response: { success: boolean; disbanded?: boolean; error?: string }) => void) => {
      try {
        const result = roomService.leaveRoom(uid);

        if (!result.success) {
          callback?.({ success: false, error: result.error });
          return;
        }

        // Leave the socket from the room
        if (result.roomId) {
          socket.leave(result.roomId);

          if (result.disbanded) {
            // Notify all players that room was disbanded
            chessNs.to(result.roomId).emit("room-disbanded", {
              roomId: result.roomId,
            });
          } else {
            // Notify remaining players
            const room = roomService.getRoom(result.roomId);
            socket.to(result.roomId).emit("player-left-room", {
              roomId: result.roomId,
              uid,
              room,
            });
          }
        }

        callback?.({ success: true, disbanded: result.disbanded });
        logger.info(`Player ${uid} left room${result.disbanded ? " (disbanded)" : ""}`);
      } catch (error) {
        logger.error(`Leave room error: ${error instanceof Error ? error.message : "Unknown error"}`);
        callback?.({ success: false, error: "Failed to leave room" });
      }
    });

    // Set ready status
    socket.on("set-ready", async (payload: SetReadyPayload, callback?: (response: { success: boolean; allReady?: boolean; error?: string }) => void) => {
      try {
        const result = roomService.setPlayerReady(uid, payload.isReady);

        if (!result.success) {
          callback?.({ success: false, error: result.error });
          return;
        }

        const roomId = result.room!.roomId;

        // Notify all players in room (including sender)
        chessNs.in(roomId).emit("player-ready-changed", {
          roomId,
          uid,
          isReady: payload.isReady,
          room: result.room,
        });

        // If all players are ready, start the game
        if (result.allReady) {
          // Call callback BEFORE starting game creation
          callback?.({ success: true, allReady: true });

          const room = result.room!;
          const [player1, player2] = room.players;

          // Create game
          const gameData = await gameManager.createGame(
            player1.uid,
            player2.uid,
            player1.socketId,
            player2.socketId,
            room.timeControl,
            roomId
          );

          // Update room with game ID
          roomService.startGame(roomId, gameData.gameId);

          // Log room members for debugging
          const socketsInRoom = await chessNs.in(roomId).fetchSockets();
          logger.info(`Sockets in room ${roomId}: ${socketsInRoom.length} - IDs: ${socketsInRoom.map(s => s.id).join(', ')}`);

          // Notify all players that game is starting (BOTH players)
          const gameStartingPayload = {
            roomId,
            gameId: gameData.gameId,
            whitePlayer: player1.uid,
            blackPlayer: player2.uid,
            gameState: {
              gameId: gameData.gameId,
              fen: gameData.fen,
              pgn: gameData.pgn,
              turn: gameData.turn,
              status: gameData.status,
              whitePlayer: gameData.whitePlayer,
              blackPlayer: gameData.blackPlayer,
              clockState: gameData.clockState,
            },
          };
          
          logger.info(`Emitting game-starting to room ${roomId} for game ${gameData.gameId}`);
          chessNs.in(roomId).emit("game-starting", gameStartingPayload);
          
          // Also emit directly to both players as backup
          if (player1.socketId) {
            chessNs.to(player1.socketId).emit("game-starting", gameStartingPayload);
          }
          if (player2.socketId) {
            chessNs.to(player2.socketId).emit("game-starting", gameStartingPayload);
          }

          logger.info(`Game ${gameData.gameId} starting in room ${roomId}`);
        } else {
          // Not all ready yet
          callback?.({ success: true, allReady: false });
        }
      } catch (error) {
        logger.error(`Set ready error: ${error instanceof Error ? error.message : "Unknown error"}`);
        callback?.({ success: false, error: "Failed to set ready status" });
      }
    });

    // List available rooms
    socket.on("list-rooms", (callback?: (response: { success: boolean; rooms?: unknown[]; error?: string }) => void) => {
      try {
        const rooms = roomService.listAvailableRooms();
        callback?.({ success: true, rooms });
      } catch (error) {
        logger.error(`List rooms error: ${error instanceof Error ? error.message : "Unknown error"}`);
        callback?.({ success: false, error: "Failed to list rooms" });
      }
    });

    // Get current room
    socket.on("get-current-room", (callback?: (response: { success: boolean; room?: unknown; error?: string }) => void) => {
      try {
        const room = roomService.getRoomByPlayer(uid);
        if (!room) {
          callback?.({ success: false, error: "Not in a room" });
          return;
        }
        callback?.({ success: true, room });
      } catch (error) {
        logger.error(`Get current room error: ${error instanceof Error ? error.message : "Unknown error"}`);
        callback?.({ success: false, error: "Failed to get current room" });
      }
    });

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

    // Play with bot
    socket.on("play-with-bot", async (
      payload: PlayWithBotPayload,
      callback?: (response: { success: boolean; gameId?: string; color?: string; error?: string }) => void
    ) => {
      try {
        const { difficulty = 'medium', timeControl } = payload;

        // Validate difficulty
        if (!['easy', 'medium', 'hard'].includes(difficulty)) {
          callback?.({ success: false, error: 'Invalid difficulty level' });
          return;
        }

        // Randomly assign color to player
        const playerColor = Math.random() < 0.5 ? 'white' : 'black';
        const botColor = playerColor === 'white' ? 'black' : 'white';

        // Create game with player and bot
        const game = await gameManager.createGame(
          playerColor === 'white' ? uid : 'BOT',
          playerColor === 'black' ? uid : 'BOT',
          playerColor === 'white' ? socket.id : 'BOT_SOCKET',
          playerColor === 'black' ? socket.id : 'BOT_SOCKET',
          timeControl
        );

        // Create bot instance
        const bot = await botManager.createBot(game.gameId, difficulty);

        // Join the game room
        socket.join(game.gameId);

        // Send response with game details
        callback?.({
          success: true,
          gameId: game.gameId,
          color: playerColor,
        });

        // Emit game-starting event
        socket.emit("game-starting", {
          gameId: game.gameId,
          whitePlayer: game.whitePlayer,
          blackPlayer: game.blackPlayer,
          playerColor,
          timeControl: game.clockConfig,
          fen: game.fen,
        });

        logger.info(`Bot game ${game.gameId} created: ${uid} (${playerColor}) vs Bot (${botColor}, ${difficulty})`);

        // If bot plays first (white), make initial move
        if (botColor === 'white') {
          setTimeout(async () => {
            await makeBotMove(game.gameId, chessNs);
          }, 1000);
        }
      } catch (error) {
        logger.error(`Play with bot error: ${error instanceof Error ? error.message : "Unknown error"}`);
        callback?.({ success: false, error: "Failed to create bot game" });
      }
    });
  });
};

/**
 * Make a bot move for the given game
 */
async function makeBotMove(gameId: string, chessNs: any): Promise<void> {
  try {
    const game = gameManager.getGame(gameId);
    if (!game) {
      logger.warn(`[Bot] Game ${gameId} not found`);
      return;
    }

    const bot = botManager.getBot(gameId);
    if (!bot) {
      logger.warn(`[Bot] No bot found for game ${gameId}`);
      return;
    }

    // Check if it's bot's turn
    const currentPlayer = game.turn === 'w' ? game.whitePlayer : game.blackPlayer;
    if (currentPlayer.uid !== 'BOT') {
      return; // Not bot's turn
    }

    logger.debug(`[Bot] Calculating move for game ${gameId}`);

    // Get best move from bot
    const moveStr = await bot.getBestMove(game.fen);
    
    // Parse move string (e.g., "e2e4" or "e7e8q")
    const from = moveStr.substring(0, 2);
    const to = moveStr.substring(2, 4);
    const promotion = moveStr.length > 4 ? moveStr[4] : undefined;

    logger.info(`[Bot] Making move in game ${gameId}: ${from} -> ${to}${promotion ? ` (${promotion})` : ''}`);

    // Apply the move
    const result = await gameManager.applyMove(gameId, currentPlayer.uid, from, to, promotion);

    if (!result.success) {
      logger.error(`[Bot] Failed to apply move in game ${gameId}: ${result.error}`);
      return;
    }

    // Get updated game state
    const updatedGame = gameManager.getGame(gameId);
    if (!updatedGame) return;

    // Emit move to all players in the game
    chessNs.to(gameId).emit("move-made", {
      gameId,
      move: result.move,
      fen: updatedGame.fen,
      currentTurn: updatedGame.turn === 'w' ? 'white' : 'black',
      gameStatus: updatedGame.status,
      isCheck: result.move?.san.includes('+') || false,
      isCheckmate: result.isGameOver && result.winner !== 'draw',
      isDraw: result.winner === 'draw',
    });

    logger.debug(`[Bot] Move applied successfully in game ${gameId}`);

    // If game is over, clean up bot
    if (updatedGame.status === 'completed') {
      botManager.removeBot(gameId);
    }
  } catch (error) {
    logger.error(`[Bot] Error making move in game ${gameId}:`, error);
  }
}

export { botManager };
