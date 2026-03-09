import { nanoid } from "nanoid";
import logger from "../../config/logger";
import redisClient from "../redis/redisClient";

export interface RoomPlayer {
  uid: string;
  socketId: string;
  joinedAt: number;
  isReady: boolean;
  colorPreference?: "white" | "black" | "random";
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

  /**
   * Create a new room
   */
  async createRoom(
    hostUid: string,
    socketId: string,
    options: {
      name?: string;
      isPrivate?: boolean;
      password?: string;
      timeControl?: { initialTimeMs: number; incrementMs: number };
    } = {}
  ): Promise<{ success: boolean; room?: RoomData; error?: string }> {
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

    await redisClient.set(`room:${roomId}`, JSON.stringify(room));

    logger.info(`Room created: ${roomId} by ${hostUid}`);
    return { success: true, room };
  }

  /**
   * Join an existing room
   */
  async joinRoom(
    uid: string,
    socketId: string,
    roomId: string,
    password?: string
  ): Promise<{ success: boolean; room?: RoomData; error?: string }> {
    if (this.playerToRoom.has(uid)) {
      const currentRoomId = this.playerToRoom.get(uid);
      if (currentRoomId === roomId) {
        const room = this.rooms.get(roomId);
        if (room) {
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

    if (room.isPrivate && room.password !== password) {
      return { success: false, error: "Invalid password" };
    }

    if (room.players.length >= room.maxPlayers) {
      return { success: false, error: "Room is full" };
    }

    if (room.status === "playing" || room.status === "completed") {
      return { success: false, error: "Room is already in game" };
    }

    room.players.push({
      uid,
      socketId,
      joinedAt: Date.now(),
      isReady: false,
    });

    this.playerToRoom.set(uid, roomId);
    logger.info(`Player ${uid} joined room ${roomId}`);

    if (room.players.length === room.maxPlayers) {
      room.status = "ready";
    }

    await redisClient.set(`room:${roomId}`, JSON.stringify(room));

    return { success: true, room };
  }

  /**
   * Leave a room
   */
  async leaveRoom(uid: string): Promise<{ success: boolean; roomId?: string; disbanded?: boolean; error?: string }> {
    const roomId = this.playerToRoom.get(uid);
    if (!roomId) {
      return { success: false, error: "Not in a room" };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      this.playerToRoom.delete(uid);
      return { success: false, error: "Room not found" };
    }

    room.players = room.players.filter((p) => p.uid !== uid);
    this.playerToRoom.delete(uid);

    if (uid === room.hostUid || room.players.length === 0) {
      this.rooms.delete(roomId);
      await redisClient.del(`room:${roomId}`);
      room.players.forEach((p) => this.playerToRoom.delete(p.uid));
      logger.info(`Room ${roomId} disbanded`);
      return { success: true, roomId, disbanded: true };
    }

    if (room.status === "ready" && room.players.length < room.maxPlayers) {
      room.status = "waiting";
    }

    await redisClient.set(`room:${roomId}`, JSON.stringify(room));

    logger.info(`Player ${uid} left room ${roomId}`);
    return { success: true, roomId, disbanded: false };
  }

  /**
   * Set player ready status
   */
  async setPlayerReady(
    uid: string,
    isReady: boolean,
    colorPreference?: "white" | "black" | "random"
  ): Promise<{ success: boolean; room?: RoomData; allReady?: boolean; error?: string }> {
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

    if (colorPreference && uid === room.hostUid) {
      player.colorPreference = colorPreference;
      logger.info(`Host ${uid} set color preference: ${colorPreference}`);
    }

    const allReady = room.players.length === room.maxPlayers && room.players.every((p) => p.isReady);

    await redisClient.set(`room:${roomId}`, JSON.stringify(room));

    logger.info(`Player ${uid} set ready=${isReady} in room ${roomId}. All ready: ${allReady}`);
    return { success: true, room, allReady };
  }

  /**
   * Mark room as playing and associate with game
   */
  async startGame(roomId: string, gameId: string): Promise<{ success: boolean; error?: string }> {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: "Room not found" };
    }

    room.status = "playing";
    room.gameId = gameId;

    await redisClient.set(`room:${roomId}`, JSON.stringify(room));

    logger.info(`Room ${roomId} started game ${gameId}`);
    return { success: true };
  }

  /**
   * Mark room as completed
   */
  async completeRoom(roomId: string): Promise<{ success: boolean; error?: string }> {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: "Room not found" };
    }

    room.status = "completed";
    await redisClient.set(`room:${roomId}`, JSON.stringify(room));

    logger.info(`Room ${roomId} completed`);
    return { success: true };
  }

  getRoom(roomId: string): RoomData | null {
    return this.rooms.get(roomId) || null;
  }

  getRoomByPlayer(uid: string): RoomData | null {
    const roomId = this.playerToRoom.get(uid);
    if (!roomId) return null;
    return this.rooms.get(roomId) || null;
  }

  listAvailableRooms(): RoomData[] {
    return Array.from(this.rooms.values()).filter(
      (room) => !room.isPrivate && (room.status === "waiting" || room.status === "ready") && room.players.length < room.maxPlayers
    );
  }

  getAllRooms(): RoomData[] {
    return Array.from(this.rooms.values());
  }

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

  async cleanupStaleRooms(): Promise<number> {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    let cleaned = 0;

    for (const [roomId, room] of this.rooms.entries()) {
      if (now - room.createdAt > oneHour && room.status !== "playing") {
        this.rooms.delete(roomId);
        room.players.forEach((p) => this.playerToRoom.delete(p.uid));
        await redisClient.del(`room:${roomId}`);
        cleaned++;
        logger.info(`Cleaned up stale room ${roomId}`);
      }
    }

    return cleaned;
  }
}

export const roomService = new RoomService();
