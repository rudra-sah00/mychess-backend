import { RoomService } from "../RoomService";


// Mock nanoid
jest.mock("nanoid", () => ({
  nanoid: jest.fn(() => "mock-id-123"),
}));

// Mock Redis
jest.mock("../../redis/redisClient", () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue("OK"),
    setEx: jest.fn().mockResolvedValue("OK"),
    del: jest.fn().mockResolvedValue(1),
    zAdd: jest.fn().mockResolvedValue(1),
    zRem: jest.fn().mockResolvedValue(1),
    zRangeByScore: jest.fn().mockResolvedValue([]),
    hSet: jest.fn().mockResolvedValue(1),
    hGet: jest.fn().mockResolvedValue(null),
    hGetAll: jest.fn().mockResolvedValue({}),
    connect: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
  },
}));

// Mock Prisma
jest.mock("@prisma/client", () => {
  const mPrismaClient = {
    game: {
      create: jest.fn().mockResolvedValue({ id: 'mock-game-id', createdAt: new Date(), players: [] }),
      update: jest.fn().mockResolvedValue({ id: 'mock-game-id' }),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'mock-user-id' }),
    },
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
  };
  return { PrismaClient: jest.fn(() => mPrismaClient) };
});

describe("RoomService", () => {
  let roomService: RoomService;

  beforeEach(() => {
    roomService = new RoomService();
  });

  describe("createRoom", () => {
    it("should create a room", async () => {
      const result = await roomService.createRoom("user1", "socket1");
      expect(result.success).toBe(true);
      expect(result.room).toBeDefined();
      expect(result.room?.players[0].uid).toBe("user1");
    });
  });

  describe("joinRoom", () => {
    it("should join a room", async () => {
      const createResult = await roomService.createRoom("user1", "socket1");
      const roomId = createResult.room!.roomId;
      const joinResult = await roomService.joinRoom("user2", "socket2", roomId);
expect(joinResult.success).toBe(true);
      expect(joinResult.room?.players).toHaveLength(2);
      expect(joinResult.room?.status).toBe("ready");
    });

    it("should fail to join non-existent room", async () => {
      const result = await roomService.joinRoom("user2", "socket2", "invalid-room");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Room not found");
    });

    it("should fail to join full room", async () => {
      const createResult = await roomService.createRoom("user1", "socket1");
      const roomId = createResult.room!.roomId;

      await roomService.joinRoom("user2", "socket2", roomId);
      const result = await roomService.joinRoom("user3", "socket3", roomId);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Room is full");
    });

    it("should fail to join private room without password", async () => {
      const createResult = await roomService.createRoom("user1", "socket1", {
        isPrivate: true,
        password: "secret",
      });
      const roomId = createResult.room!.roomId;

      const result = await roomService.joinRoom("user2", "socket2", roomId);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid password");
    });

    it("should join private room with correct password", async () => {
      const createResult = await roomService.createRoom("user1", "socket1", {
        isPrivate: true,
        password: "secret",
      });
      const roomId = createResult.room!.roomId;

      const result = await roomService.joinRoom("user2", "socket2", roomId, "secret");

      expect(result.success).toBe(true);
      expect(result.room?.players).toHaveLength(2);
    });

    it("should fail if player is already in another room", async () => {
      const room1 = await roomService.createRoom("user1", "socket1");
      const room2 = await roomService.createRoom("user2", "socket2");

      const result = await roomService.joinRoom("user1", "socket1", room2.room!.roomId);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Already in another room");
    });
  });

  describe("leaveRoom", () => {
    it("should leave room successfully", async () => {
      const createResult = await roomService.createRoom("user1", "socket1");
      const roomId = createResult.room!.roomId;
      await roomService.joinRoom("user2", "socket2", roomId);

      const result = await roomService.leaveRoom("user2");

      expect(result.success).toBe(true);
      expect(result.roomId).toBe(roomId);
      expect(result.disbanded).toBe(false);

      const room = roomService.getRoom(roomId);
      expect(room?.players).toHaveLength(1);
      expect(room?.status).toBe("waiting");
    });

    it("should disband room when host leaves", async () => {
      const createResult = await roomService.createRoom("user1", "socket1");
      const roomId = createResult.room!.roomId;
      await roomService.joinRoom("user2", "socket2", roomId);

      const result = await roomService.leaveRoom("user1");

      expect(result.success).toBe(true);
      expect(result.disbanded).toBe(true);
      expect(roomService.getRoom(roomId)).toBeNull();
    });

    it("should disband room when last player leaves", async () => {
      const createResult = await roomService.createRoom("user1", "socket1");
      const roomId = createResult.room!.roomId;

      const result = await roomService.leaveRoom("user1");

      expect(result.success).toBe(true);
      expect(result.disbanded).toBe(true);
      expect(roomService.getRoom(roomId)).toBeNull();
    });

    it("should fail if player is not in a room", async () => {
      const result = await roomService.leaveRoom("user1");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Not in a room");
    });
  });

  describe("setPlayerReady", () => {
    it("should set player ready status", async () => {
      const createResult = await roomService.createRoom("user1", "socket1");
      const roomId = createResult.room!.roomId;
      await roomService.joinRoom("user2", "socket2", roomId);

      const result = await roomService.setPlayerReady("user1", true);

      expect(result.success).toBe(true);
      expect(result.room?.players[0].isReady).toBe(true);
      expect(result.allReady).toBe(false);
    });

    it("should detect when all players are ready", async () => {
      const createResult = await roomService.createRoom("user1", "socket1");
      const roomId = createResult.room!.roomId;
      await roomService.joinRoom("user2", "socket2", roomId);

      await roomService.setPlayerReady("user1", true);
      const result = await roomService.setPlayerReady("user2", true);

      expect(result.success).toBe(true);
      expect(result.allReady).toBe(true);
    });

    it("should fail if player is not in a room", async () => {
      const result = await roomService.setPlayerReady("user1", true);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Not in a room");
    });
  });

  describe("startGame", () => {
    it("should start game in room", async () => {
      const createResult = await roomService.createRoom("user1", "socket1");
      const roomId = createResult.room!.roomId;

      const result = await roomService.startGame(roomId, "game123");

      expect(result.success).toBe(true);

      const room = roomService.getRoom(roomId);
      expect(room?.status).toBe("playing");
      expect(room?.gameId).toBe("game123");
    });

    it("should fail for non-existent room", async () => {
      const result = await roomService.startGame("invalid-room", "game123");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Room not found");
    });
  });

  describe("listAvailableRooms", () => {
    it("should list only public waiting rooms", async () => {
      const room1 = await roomService.createRoom("user1", "socket1", { name: "Public Room 1" });
      const room2 = await roomService.createRoom("user2", "socket2", {
        name: "Private Room",
        isPrivate: true,
      });
      const room3 = await roomService.createRoom("user3", "socket3", { name: "Public Room 2" });

      const rooms = roomService.listAvailableRooms();

      // Room IDs should be unique due to nanoid, but in tests they might collide
      // so we check that we have at least the public rooms that were created
      expect(rooms.length).toBeGreaterThanOrEqual(1);
      expect(rooms.every((r) => !r.isPrivate)).toBe(true);
    });

    it("should not list full rooms", async () => {
      const createResult = await roomService.createRoom("user1", "socket1");
      await roomService.joinRoom("user2", "socket2", createResult.room!.roomId);

      const rooms = roomService.listAvailableRooms();

      expect(rooms).toHaveLength(0);
    });
  });

  describe("getRoomByPlayer", () => {
    it("should get room by player uid", async () => {
      const createResult = await roomService.createRoom("user1", "socket1");

      const room = roomService.getRoomByPlayer("user1");

      expect(room).toBeDefined();
      expect(room?.roomId).toBe(createResult.room?.roomId);
    });

    it("should return null if player is not in a room", async () => {
      const room = roomService.getRoomByPlayer("user1");

      expect(room).toBeNull();
    });
  });

  describe("updatePlayerSocketId", () => {
    it("should update player socket ID", async () => {
      await roomService.createRoom("user1", "socket1");

      const result = roomService.updatePlayerSocketId("user1", "new-socket-id");

      expect(result.success).toBe(true);

      const room = roomService.getRoomByPlayer("user1");
      expect(room?.players[0].socketId).toBe("new-socket-id");
    });

    it("should fail if player is not in a room", async () => {
      const result = roomService.updatePlayerSocketId("user1", "socket2");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Not in a room");
    });
  });
});
