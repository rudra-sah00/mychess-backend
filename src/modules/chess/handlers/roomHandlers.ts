import { Socket } from "socket.io";
import { gameManager } from "../../../services/chess/GameManager";
import { roomService } from "../../../services/room/RoomService";
import logger from "../../../config/logger";

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
  colorPreference?: "white" | "black" | "random";
}

export const registerRoomHandlers = (socket: Socket, chessNs: any) => {
  const uid = socket.data.uid as string;
  const username = socket.data.username as string || 'Player';

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
      const result = roomService.setPlayerReady(uid, payload.isReady, payload.colorPreference);

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
        
        // Determine colors based on host's preference
        const host = room.players.find(p => p.uid === room.hostUid)!;
        const guest = room.players.find(p => p.uid !== room.hostUid)!;
        
        let whitePlayer = player1;
        let blackPlayer = player2;
        
        if (host.colorPreference === "white") {
          // Host wants white
          whitePlayer = host;
          blackPlayer = guest;
          logger.info(`Host ${host.uid} chose white, guest ${guest.uid} is black`);
        } else if (host.colorPreference === "black") {
          // Host wants black
          whitePlayer = guest;
          blackPlayer = host;
          logger.info(`Host ${host.uid} chose black, guest ${guest.uid} is white`);
        } else {
          // Random assignment
          const randomChoice = Math.random() < 0.5;
          whitePlayer = randomChoice ? host : guest;
          blackPlayer = randomChoice ? guest : host;
          logger.info(`Random color assignment: host ${host.uid} is ${randomChoice ? 'white' : 'black'}`);
        }

        // Create game
        const gameData = await gameManager.createGame(
          whitePlayer.uid,
          blackPlayer.uid,
          whitePlayer.socketId,
          blackPlayer.socketId,
          room.timeControl,
          roomId,
          username, // Pass username for both players (they're in the same room)
          username
        );

        // Update room with game ID
        roomService.startGame(roomId, gameData.gameId);

        // Log room members for debugging
        const socketsInRoom = await chessNs.in(roomId).fetchSockets();
        logger.info(`Sockets in room ${roomId}: ${socketsInRoom.length} - IDs: ${socketsInRoom.map((s: any) => s.id).join(', ')}`);

        // Notify all players that game is starting (BOTH players)
        const gameStartingPayload = {
          roomId,
          gameId: gameData.gameId,
          whitePlayer: whitePlayer.uid,
          blackPlayer: blackPlayer.uid,
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
        if (whitePlayer.socketId) {
          chessNs.to(whitePlayer.socketId).emit("game-starting", gameStartingPayload);
        }
        if (blackPlayer.socketId) {
          chessNs.to(blackPlayer.socketId).emit("game-starting", gameStartingPayload);
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
};
