import { nanoid } from "nanoid";
import logger from "../../config/logger";
import { firebaseAdmin } from "../firebase/firebaseAdmin";

export interface RoomPlayer {
  uid: string;
  socketId: string;
  joinedAt: number;
  isReady: boolean;
}

export interface RoomData {
  roomId: string;
  name: string;
  hostUid: string;
  players: RoomPlayer[];
  maxPlayers: 2;
  status: "waiting" | "ready" | "playing" | "completed";
  gameId?: string;
  createdAt: number;
  isPrivate: boolean;
  password?: string;
  timeControl?: {
    initialTimeMs: number;
    incrementMs: number;
  };
}

export class RoomService {
  private rooms: Map<string, RoomData> = new Map();
  private playerToRoom: Map<string, string> = new Map(); // uid -> roomId
  private db = firebaseAdmin.getDatabase();

  /**
   * Create a new room
   */
  createRoom(
    hostUid: string,
    socketId: string,
    options: {
      name?: string;
      isPrivate?: boolean;
      password?: string;
      timeControl?: { initialTimeMs: number; incrementMs: number };
    } = {}
  ): { success: boolean; room?: RoomData; error?: string } {
    // Check if player is already in a room
    if (this.playerToRoom.has(hostUid)) {
      return { success: false, error: "Already in a room" };
    }

    const roomId = nanoid(8);
    const now = Date.now();

    const room: RoomData = {
      roomId,
      name: options.name || `Room ${roomId}`,
      hostUid,
      players: [
        {
          uid: hostUid,
          socketId,
          joinedAt: now,
          isReady: false,
        },
      ],
      maxPlayers: 2,
      status: "waiting",
      createdAt: now,
      isPrivate: options.isPrivate || false,
      password: options.password,
      timeControl: options.timeControl,
    };

    this.rooms.set(roomId, room);
    this.playerToRoom.set(hostUid, roomId);

    // Persist to Firebase (exclude undefined password)
    const roomData: any = {
      roomId: room.roomId,
      name: room.name,
      hostUid: room.hostUid,
      players: room.players.map((p) => ({ uid: p.uid, joinedAt: p.joinedAt, isReady: p.isReady })),
      maxPlayers: room.maxPlayers,
      status: room.status,
      createdAt: room.createdAt,
      isPrivate: room.isPrivate,
    };
    
    if (room.password) {
      roomData.password = room.password;
    }
    
    if (room.timeControl) {
      roomData.timeControl = room.timeControl;
    }

    this.db.ref(`rooms/${roomId}`).set(roomData);

    logger.info(`Room created: ${roomId} by ${hostUid}`);
    return { success: true, room };
  }

  /**
   * Join an existing room
   */
  joinRoom(
    uid: string,
    socketId: string,
    roomId: string,
    password?: string
  ): { success: boolean; room?: RoomData; error?: string } {
    // Check if player is already in a room
    if (this.playerToRoom.has(uid)) {
      const currentRoomId = this.playerToRoom.get(uid);
      if (currentRoomId === roomId) {
        // Rejoin same room (reconnection)
        const room = this.rooms.get(roomId);
        if (room) {
          // Update socket ID
          const player = room.players.find((p) => p.uid === uid);
          if (player) {
            player.socketId = socketId;
            return { success: true, room };
          }
        }
      }
      return { success: false, error: "Already in another room" };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: "Room not found" };
    }

    // Check password for private rooms
    if (room.isPrivate && room.password !== password) {
      return { success: false, error: "Invalid password" };
    }

    // Check if room is full
    if (room.players.length >= room.maxPlayers) {
      return { success: false, error: "Room is full" };
    }

    // Check if room is already playing
    if (room.status === "playing" || room.status === "completed") {
      return { success: false, error: "Room is already in game" };
    }

    // Add player to room
    room.players.push({
      uid,
      socketId,
      joinedAt: Date.now(),
      isReady: false,
    });

    this.playerToRoom.set(uid, roomId);

    // Update Firebase
    this.db.ref(`rooms/${roomId}/players`).set(
      room.players.map((p) => ({ uid: p.uid, joinedAt: p.joinedAt, isReady: p.isReady }))
    );

    logger.info(`Player ${uid} joined room ${roomId}`);

    // Check if room is ready (2 players)
    if (room.players.length === room.maxPlayers) {
      room.status = "ready";
      this.db.ref(`rooms/${roomId}/status`).set("ready");
    }

    return { success: true, room };
  }

  /**
   * Leave a room
   */
  leaveRoom(uid: string): { success: boolean; roomId?: string; disbanded?: boolean; error?: string } {
    const roomId = this.playerToRoom.get(uid);
    if (!roomId) {
      return { success: false, error: "Not in a room" };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      this.playerToRoom.delete(uid);
      return { success: false, error: "Room not found" };
    }

    // Remove player from room
    room.players = room.players.filter((p) => p.uid !== uid);
    this.playerToRoom.delete(uid);

    // If host left or room is empty, disband room
    if (uid === room.hostUid || room.players.length === 0) {
      this.rooms.delete(roomId);
      this.db.ref(`rooms/${roomId}`).remove();
      
      // Remove all remaining players from tracking
      room.players.forEach((p) => this.playerToRoom.delete(p.uid));
      
      logger.info(`Room ${roomId} disbanded`);
      return { success: true, roomId, disbanded: true };
    }

    // Update status if needed
    if (room.status === "ready" && room.players.length < room.maxPlayers) {
      room.status = "waiting";
      this.db.ref(`rooms/${roomId}/status`).set("waiting");
    }

    // Update Firebase
    this.db.ref(`rooms/${roomId}/players`).set(
      room.players.map((p) => ({ uid: p.uid, joinedAt: p.joinedAt, isReady: p.isReady }))
    );

    logger.info(`Player ${uid} left room ${roomId}`);
    return { success: true, roomId, disbanded: false };
  }

  /**
   * Set player ready status
   */
  setPlayerReady(uid: string, isReady: boolean): { success: boolean; room?: RoomData; allReady?: boolean; error?: string } {
    const roomId = this.playerToRoom.get(uid);
    if (!roomId) {
      return { success: false, error: "Not in a room" };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: "Room not found" };
    }

    const player = room.players.find((p) => p.uid === uid);
    if (!player) {
      return { success: false, error: "Player not in room" };
    }

    player.isReady = isReady;

    // Update Firebase
    this.db.ref(`rooms/${roomId}/players`).set(
      room.players.map((p) => ({ uid: p.uid, joinedAt: p.joinedAt, isReady: p.isReady }))
    );

    // Check if all players are ready
    const allReady = room.players.length === room.maxPlayers && room.players.every((p) => p.isReady);

    logger.info(`Player ${uid} set ready=${isReady} in room ${roomId}. All ready: ${allReady}`);
    return { success: true, room, allReady };
  }

  /**
   * Mark room as playing and associate with game
   */
  startGame(roomId: string, gameId: string): { success: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: "Room not found" };
    }

    room.status = "playing";
    room.gameId = gameId;

    this.db.ref(`rooms/${roomId}`).update({
      status: "playing",
      gameId,
    });

    logger.info(`Room ${roomId} started game ${gameId}`);
    return { success: true };
  }

  /**
   * Mark room as completed
   */
  completeRoom(roomId: string): { success: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: "Room not found" };
    }

    room.status = "completed";
    this.db.ref(`rooms/${roomId}/status`).set("completed");

    logger.info(`Room ${roomId} completed`);
    return { success: true };
  }

  /**
   * Get room data
   */
  getRoom(roomId: string): RoomData | null {
    return this.rooms.get(roomId) || null;
  }

  /**
   * Get room by player UID
   */
  getRoomByPlayer(uid: string): RoomData | null {
    const roomId = this.playerToRoom.get(uid);
    if (!roomId) return null;
    return this.rooms.get(roomId) || null;
  }

  /**
   * List all available rooms (public only)
   */
  listAvailableRooms(): RoomData[] {
    return Array.from(this.rooms.values()).filter(
      (room) => !room.isPrivate && (room.status === "waiting" || room.status === "ready") && room.players.length < room.maxPlayers
    );
  }

  /**
   * Get all rooms (for admin/debugging)
   */
  getAllRooms(): RoomData[] {
    return Array.from(this.rooms.values());
  }

  /**
   * Update player socket ID (for reconnections)
   */
  updatePlayerSocketId(uid: string, socketId: string): { success: boolean; error?: string } {
    const roomId = this.playerToRoom.get(uid);
    if (!roomId) {
      return { success: false, error: "Not in a room" };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: "Room not found" };
    }

    const player = room.players.find((p) => p.uid === uid);
    if (!player) {
      return { success: false, error: "Player not in room" };
    }

    player.socketId = socketId;
    return { success: true };
  }

  /**
   * Clean up stale rooms (older than 1 hour with no activity)
   */
  cleanupStaleRooms(): number {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    let cleaned = 0;

    for (const [roomId, room] of this.rooms.entries()) {
      if (now - room.createdAt > oneHour && room.status !== "playing") {
        this.rooms.delete(roomId);
        room.players.forEach((p) => this.playerToRoom.delete(p.uid));
        this.db.ref(`rooms/${roomId}`).remove();
        cleaned++;
        logger.info(`Cleaned up stale room ${roomId}`);
      }
    }

    return cleaned;
  }
}

// Singleton instance
export const roomService = new RoomService();
