import { matchmakingService } from "../MatchmakingService";
import { gameManager } from "../../chess/GameManager";

// Mock dependencies
jest.mock("../../firebase/firebaseAdmin", () => ({
  firebaseAdmin: {
    getDatabase: jest.fn(() => ({
      ref: jest.fn(() => ({
        set: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn().mockResolvedValue(undefined),
      })),
    })),
  },
}));

jest.mock("../../chess/GameManager", () => ({
  gameManager: {
    createGame: jest.fn().mockResolvedValue({
      gameId: "test-game-123",
      whitePlayer: { uid: "user1", socketId: "socket1" },
      blackPlayer: { uid: "user2", socketId: "socket2" },
      status: "active",
      createdAt: Date.now(),
    }),
  },
}));

describe("MatchmakingService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("joinQueue", () => {
    it("should add player to queue", async () => {
      const result = await matchmakingService.joinQueue({
        uid: "user1",
        socketId: "socket1",
        rating: 1500,
        requestedAt: Date.now(),
      });

      expect(result.success).toBe(true);
      expect(matchmakingService.getQueueSize()).toBe(1);
    });

    it("should reject if player already in queue", async () => {
      await matchmakingService.joinQueue({
        uid: "user1",
        socketId: "socket1",
        rating: 1500,
        requestedAt: Date.now(),
      });

      const result = await matchmakingService.joinQueue({
        uid: "user1",
        socketId: "socket1",
        rating: 1500,
        requestedAt: Date.now(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Already in queue");
    });

    it("should create match when two players with similar ratings join", async () => {
      const matchFoundCallback = jest.fn();
      matchmakingService.setMatchFoundCallback(matchFoundCallback);

      await matchmakingService.joinQueue({
        uid: "user1",
        socketId: "socket1",
        rating: 1500,
        requestedAt: Date.now(),
      });

      await matchmakingService.joinQueue({
        uid: "user2",
        socketId: "socket2",
        rating: 1550,
        requestedAt: Date.now(),
      });

      // Players should be matched and removed from queue
      expect(matchmakingService.getQueueSize()).toBe(0);
      expect(gameManager.createGame).toHaveBeenCalled();
      // Callback should be called with both users (order doesn't matter)
      expect(matchFoundCallback).toHaveBeenCalled();
      const callArgs = matchFoundCallback.mock.calls[0];
      expect(callArgs).toContain("user1");
      expect(callArgs).toContain("user2");
      expect(callArgs[2]).toBe("test-game-123");
    });

    it("should not match players with different time controls", async () => {
      await matchmakingService.joinQueue({
        uid: "user1",
        socketId: "socket1",
        rating: 1500,
        timeControl: { initialTimeMs: 600000, incrementMs: 0 },
        requestedAt: Date.now(),
      });

      await matchmakingService.joinQueue({
        uid: "user2",
        socketId: "socket2",
        rating: 1500,
        timeControl: { initialTimeMs: 300000, incrementMs: 5000 },
        requestedAt: Date.now(),
      });

      // Players should remain in queue
      expect(matchmakingService.getQueueSize()).toBe(2);
      expect(gameManager.createGame).not.toHaveBeenCalled();
    });

    it("should not match players with too large rating difference", async () => {
      await matchmakingService.joinQueue({
        uid: "user1",
        socketId: "socket1",
        rating: 1200,
        requestedAt: Date.now(),
      });

      await matchmakingService.joinQueue({
        uid: "user2",
        socketId: "socket2",
        rating: 1500,
        requestedAt: Date.now(),
      });

      // Players should remain in queue (rating diff > 200)
      expect(matchmakingService.getQueueSize()).toBe(2);
      expect(gameManager.createGame).not.toHaveBeenCalled();
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
