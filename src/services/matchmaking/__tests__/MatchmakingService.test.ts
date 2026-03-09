import { matchmakingService } from "../MatchmakingService";
import { gameManager } from "../../chess/GameManager";


// Mock nanoid
jest.mock("nanoid", () => ({
  nanoid: jest.fn(() => "mock-id-123"),
}));

// Mock dependencies
jest.mock("../../chess/GameManager", () => ({
  gameManager: {
    createGame: jest.fn().mockResolvedValue({
      gameId: "test-game-123",
      whitePlayer: { uid: "user1", socketId: "socket1" },
      blackPlayer: { uid: "user2", socketId: "socket2" },
      status: "active",
      createdAt: new Date(),
    }),
  },
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

describe("MatchmakingService", () => {
  describe("joinQueue", () => {
    it("should add player to queue", async () => {
      const result = await matchmakingService.joinQueue({
        uid: "user-jq-1",
        socketId: "socket1",
        rating: 1500,
        requestedAt: Date.now(),
      });
      expect(result.success).toBe(true);
      expect(matchmakingService.getQueueSize()).toBeGreaterThan(0);
      await matchmakingService.leaveQueue("user-jq-1");
    });

    it("should fail if player already in queue", async () => {
      await matchmakingService.joinQueue({
        uid: "user-jq-2",
        socketId: "socket2",
        rating: 1500,
        requestedAt: Date.now(),
      });
      const result = await matchmakingService.joinQueue({
        uid: "user-jq-2",
        socketId: "socket2",
        rating: 1500,
        requestedAt: Date.now(),
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe("Already in queue");
      await matchmakingService.leaveQueue("user-jq-2");
    });
  });

describe("leaveQueue", () => {
    it("should remove player from queue", async () => {
      // Clear any existing state first
      await matchmakingService.leaveQueue("user1");

      await matchmakingService.joinQueue({
        uid: "user1",
        socketId: "socket1",
        rating: 1500,
        requestedAt: Date.now(),
      });

      const result = await matchmakingService.leaveQueue("user1");

      expect(result.success).toBe(true);
    });

    it("should return false if player not in queue", async () => {
      const result = await matchmakingService.leaveQueue("non-existent-user");
      expect(result.success).toBe(false);
    });
  });

  describe("getPlayerPosition", () => {
    it("should return player position in queue", async () => {
      // Use unique ratings to avoid matching
      await matchmakingService.joinQueue({
        uid: "user-pos-1",
        socketId: "socket-pos-1",
        rating: 1200,
        requestedAt: Date.now(),
      });

      await matchmakingService.joinQueue({
        uid: "user-pos-2",
        socketId: "socket-pos-2",
        rating: 1800, // Different rating to avoid matching
        requestedAt: Date.now() + 100,
      });

      const position = matchmakingService.getPlayerPosition("user-pos-2");
      expect(position).toBeGreaterThan(0);

      // Cleanup
      await matchmakingService.leaveQueue("user-pos-1");
      await matchmakingService.leaveQueue("user-pos-2");
    });

    it("should return null if player not in queue", () => {
      const position = matchmakingService.getPlayerPosition("non-existent-user");
      expect(position).toBeNull();
    });
  });

  describe("getQueueSize", () => {
    it("should return correct queue size", async () => {
      // Use unique IDs and ratings to avoid conflicts with other tests
      const initialSize = matchmakingService.getQueueSize();

      await matchmakingService.joinQueue({
        uid: "user-size-1",
        socketId: "socket-size-1",
        rating: 1300,
        requestedAt: Date.now(),
      });

      expect(matchmakingService.getQueueSize()).toBe(initialSize + 1);

      await matchmakingService.joinQueue({
        uid: "user-size-2",
        socketId: "socket-size-2",
        rating: 1900,
        requestedAt: Date.now(),
      });

      expect(matchmakingService.getQueueSize()).toBe(initialSize + 2);

      // Cleanup
      await matchmakingService.leaveQueue("user-size-1");
      await matchmakingService.leaveQueue("user-size-2");
    });
  });
});
