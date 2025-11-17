import { Server, Socket } from "socket.io";
import { socketAuthMiddleware } from "../../middleware/socketAuth";
import { gameManager } from "../../services/chess/GameManager";
import { matchmakingService } from "../../services/matchmaking/MatchmakingService";
import logger from "../../config/logger";
import { registerConnectionHandlers } from "./handlers/connectionHandlers";
import { registerGameHandlers } from "./handlers/gameHandlers";
import { registerBotHandlers } from "./handlers/botHandlers";
import { registerRoomHandlers } from "./handlers/roomHandlers";
import { registerMatchmakingHandlers } from "./handlers/matchmakingHandlers";

export const registerChessNamespace = (io: Server) => {
  const chessNs = io.of("/chess");

  // Apply authentication middleware
  chessNs.use(socketAuthMiddleware);

  // Set socket.io instance in GameManager for disconnect handling
  gameManager.setSocketIO(io);

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

  chessNs.on("connection", async (socket: Socket) => {
    const uid = socket.data.uid as string;
    const username = socket.data.username as string || 'Player';

    logger.info(`Player ${uid} (${username}) connected to chess namespace`);

    // Register all handlers
    registerConnectionHandlers(socket, chessNs);
    registerGameHandlers(socket, chessNs);
    registerBotHandlers(socket, chessNs);
    registerRoomHandlers(socket, chessNs);
    registerMatchmakingHandlers(socket);
  });
};

export { botManager } from "./botManager";
