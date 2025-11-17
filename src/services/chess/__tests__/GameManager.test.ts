import { gameManager } from "../GameManager";

// Mock nanoid
jest.mock("nanoid", () => ({
  nanoid: jest.fn(() => "test-game-id-123"),
}));

// Mock Firebase
jest.mock("../../firebase/firebaseAdmin", () => ({
  firebaseAdmin: {
    getDatabase: jest.fn(() => ({
      ref: jest.fn(() => ({
        set: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn().mockResolvedValue(undefined),
        once: jest.fn().mockResolvedValue({
          exists: () => false,
          val: () => null,
        }),
      })),
    })),
  },
}));

describe("GameManager", () => {
  const mockWhiteUid = "white-user-123";
  const mockBlackUid = "black-user-456";
  const mockWhiteSocket = "socket-white-123";
  const mockBlackSocket = "socket-black-456";

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("createGame", () => {
    it("should create a game without time control", async () => {
      const game = await gameManager.createGame(
        mockWhiteUid,
        mockBlackUid,
        mockWhiteSocket,
        mockBlackSocket
      );

      expect(game).toBeDefined();
      expect(game.gameId).toBeDefined();
      expect(game.whitePlayer.uid).toBe(mockWhiteUid);
      expect(game.blackPlayer.uid).toBe(mockBlackUid);
      expect(game.status).toBe("active");
      expect(game.turn).toBe("w");
      expect(game.clockConfig).toBeUndefined();
    });

    it("should create a game with time control", async () => {
      const clockConfig = {
        initialTimeMs: 600000,
        incrementMs: 5000,
      };

      const game = await gameManager.createGame(
        mockWhiteUid,
        mockBlackUid,
        mockWhiteSocket,
        mockBlackSocket,
        clockConfig
      );

      expect(game.clockConfig).toEqual(clockConfig);
      expect(game.clockState).toBeDefined();
      expect(game.clockState?.activeColor).toBe("w");
    });
  });

  describe("applyMove", () => {
    it("should apply valid move", async () => {
      const game = await gameManager.createGame(
        mockWhiteUid,
        mockBlackUid,
        mockWhiteSocket,
        mockBlackSocket
      );

      const result = await gameManager.applyMove(game.gameId, mockWhiteUid, "e2", "e4");

      expect(result.success).toBe(true);
      expect(result.move).toBeDefined();
      expect(result.move?.san).toBe("e4");
      expect(result.isGameOver).toBe(false);

      const updatedGame = gameManager.getGame(game.gameId);
      expect(updatedGame?.turn).toBe("b");
    });

    it("should reject move when not player's turn", async () => {
      const game = await gameManager.createGame(
        mockWhiteUid,
        mockBlackUid,
        mockWhiteSocket,
        mockBlackSocket
      );

      const result = await gameManager.applyMove(game.gameId, mockBlackUid, "e7", "e5");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Not your turn");
    });

    it("should reject move from non-player", async () => {
      const game = await gameManager.createGame(
        mockWhiteUid,
        mockBlackUid,
        mockWhiteSocket,
        mockBlackSocket
      );

      const result = await gameManager.applyMove(game.gameId, "random-user", "e2", "e4");

      expect(result.success).toBe(false);
      expect(result.error).toBe("You are not a player in this game");
    });

    it("should reject invalid move", async () => {
      const game = await gameManager.createGame(
        mockWhiteUid,
        mockBlackUid,
        mockWhiteSocket,
        mockBlackSocket
      );

      const result = await gameManager.applyMove(game.gameId, mockWhiteUid, "e2", "e5");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid move format");
    });

    it("should handle game not found", async () => {
      const result = await gameManager.applyMove("non-existent-game", mockWhiteUid, "e2", "e4");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Game not found");
    });
  });

  describe("resign", () => {
    it("should handle resignation", async () => {
      const game = await gameManager.createGame(
        mockWhiteUid,
        mockBlackUid,
        mockWhiteSocket,
        mockBlackSocket
      );

      const result = await gameManager.resign(game.gameId, mockWhiteUid);

      expect(result.success).toBe(true);
      expect(result.isGameOver).toBe(true);
      expect(result.winner).toBe("black");
      expect(result.reason).toBe("resignation");

      const updatedGame = gameManager.getGame(game.gameId);
      expect(updatedGame?.status).toBe("completed");
    });

    it("should reject resignation from non-player", async () => {
      const game = await gameManager.createGame(
        mockWhiteUid,
        mockBlackUid,
        mockWhiteSocket,
        mockBlackSocket
      );

      const result = await gameManager.resign(game.gameId, "random-user");

      expect(result.success).toBe(false);
      expect(result.error).toBe("You are not a player in this game");
    });
  });

  describe("draw offers", () => {
    it("should offer draw", async () => {
      const game = await gameManager.createGame(
        mockWhiteUid,
        mockBlackUid,
        mockWhiteSocket,
        mockBlackSocket
      );

      const result = await gameManager.offerDraw(game.gameId, mockWhiteUid);

      expect(result.success).toBe(true);

      const updatedGame = gameManager.getGame(game.gameId);
      expect(updatedGame?.drawOffer).toEqual({ from: "white", pending: true });
    });

    it("should accept draw offer", async () => {
      const game = await gameManager.createGame(
        mockWhiteUid,
        mockBlackUid,
        mockWhiteSocket,
        mockBlackSocket
      );

      await gameManager.offerDraw(game.gameId, mockWhiteUid);
      const result = await gameManager.respondToDrawOffer(game.gameId, mockBlackUid, true);

      expect(result.success).toBe(true);
      if ("isGameOver" in result) {
        expect(result.isGameOver).toBe(true);
        expect(result.winner).toBe("draw");
        expect(result.reason).toBe("agreement");
      }

      const updatedGame = gameManager.getGame(game.gameId);
      expect(updatedGame?.status).toBe("completed");
    });

    it("should decline draw offer", async () => {
      const game = await gameManager.createGame(
        mockWhiteUid,
        mockBlackUid,
        mockWhiteSocket,
        mockBlackSocket
      );

      await gameManager.offerDraw(game.gameId, mockWhiteUid);
      const result = await gameManager.respondToDrawOffer(game.gameId, mockBlackUid, false);

      expect(result.success).toBe(true);

      const updatedGame = gameManager.getGame(game.gameId);
      expect(updatedGame?.drawOffer).toBeUndefined();
      expect(updatedGame?.status).toBe("active");
    });

    it("should reject draw response when no offer pending", async () => {
      const game = await gameManager.createGame(
        mockWhiteUid,
        mockBlackUid,
        mockWhiteSocket,
        mockBlackSocket
      );

      const result = await gameManager.respondToDrawOffer(game.gameId, mockBlackUid, true);

      expect(result.success).toBe(false);
      expect(result.error).toBe("No pending draw offer");
    });
  });

  describe("getGame", () => {
    it("should return game data", async () => {
      const game = await gameManager.createGame(
        mockWhiteUid,
        mockBlackUid,
        mockWhiteSocket,
        mockBlackSocket
      );

      const retrieved = gameManager.getGame(game.gameId);

      expect(retrieved).toEqual(game);
    });

    it("should return null for non-existent game", () => {
      const retrieved = gameManager.getGame("non-existent-game");
      expect(retrieved).toBeNull();
    });
  });

  describe("updateSocketId", () => {
    it("should update white player socket ID", async () => {
      const game = await gameManager.createGame(
        mockWhiteUid,
        mockBlackUid,
        mockWhiteSocket,
        mockBlackSocket
      );

      const newSocketId = "new-socket-123";
      await gameManager.updateSocketId(game.gameId, mockWhiteUid, newSocketId);

      const updatedGame = gameManager.getGame(game.gameId);
      expect(updatedGame?.whitePlayer.socketId).toBe(newSocketId);
    });

    it("should update black player socket ID", async () => {
      const game = await gameManager.createGame(
        mockWhiteUid,
        mockBlackUid,
        mockWhiteSocket,
        mockBlackSocket
      );

      const newSocketId = "new-socket-456";
      await gameManager.updateSocketId(game.gameId, mockBlackUid, newSocketId);

      const updatedGame = gameManager.getGame(game.gameId);
      expect(updatedGame?.blackPlayer.socketId).toBe(newSocketId);
    });
  });

  describe("removeGame", () => {
    it("should remove game from memory", async () => {
      const game = await gameManager.createGame(
        mockWhiteUid,
        mockBlackUid,
        mockWhiteSocket,
        mockBlackSocket
      );

      gameManager.removeGame(game.gameId);

      const retrieved = gameManager.getGame(game.gameId);
      expect(retrieved).toBeNull();
    });
  });
});
