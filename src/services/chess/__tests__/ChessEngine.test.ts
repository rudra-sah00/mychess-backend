import { ChessEngine } from "../ChessEngine";

describe("ChessEngine", () => {
  let engine: ChessEngine;

  beforeEach(() => {
    engine = new ChessEngine("test-game-1");
  });

  describe("validateMove", () => {
    it("should accept valid opening move", () => {
      const result = engine.validateMove("e2", "e4", undefined, "user1", "w");
      expect(result.success).toBe(true);
      expect(result.move).toBeDefined();
      expect(result.move?.san).toBe("e4");
      expect(result.isGameOver).toBe(false);
    });

    it("should reject invalid move", () => {
      const result = engine.validateMove("e2", "e5", undefined, "user1", "w");
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Illegal move|Invalid move format/);
    });

    it("should reject move when not player's turn", () => {
      const result = engine.validateMove("e7", "e5", undefined, "user2", "b");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Not your turn");
    });

    it("should handle pawn promotion", () => {
      // Set up position for promotion
      engine.loadFen("8/P7/8/8/8/8/8/4K2k w - - 0 1");
      const result = engine.validateMove("a7", "a8", "q", "user1", "w");
      expect(result.success).toBe(true);
      expect(result.move?.promotion).toBe("q");
    });

    it("should detect checkmate", () => {
      // Fool's mate setup
      engine.loadFen("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3");
      const state = engine.getGameState();
      expect(state.isCheckmate).toBe(true);
      expect(state.isGameOver).toBe(true);
    });
  });

  describe("getGameState", () => {
    it("should return correct initial state", () => {
      const state = engine.getGameState();
      expect(state.fen).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
      expect(state.turn).toBe("w");
      expect(state.isCheck).toBe(false);
      expect(state.isCheckmate).toBe(false);
      expect(state.isGameOver).toBe(false);
      expect(state.history).toHaveLength(0);
    });

    it("should track move history", () => {
      engine.validateMove("e2", "e4", undefined, "user1", "w");
      engine.validateMove("e7", "e5", undefined, "user2", "b");
      const state = engine.getGameState();
      expect(state.history).toHaveLength(2);
      expect(state.turn).toBe("w");
    });
  });

  describe("getLegalMoves", () => {
    it("should return legal moves for starting position pawn", () => {
      const moves = engine.getLegalMoves("e2");
      expect(moves).toContain("e3");
      expect(moves).toContain("e4");
      expect(moves).toHaveLength(2);
    });

    it("should return empty array for empty square", () => {
      const moves = engine.getLegalMoves("e5");
      expect(moves).toHaveLength(0);
    });
  });

  describe("loadFen", () => {
    it("should load valid FEN", () => {
      const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
      const success = engine.loadFen(fen);
      expect(success).toBe(true);
      // chess.js may normalize en passant square
      expect(engine.getFen()).toContain("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq");
    });

    it("should reject invalid FEN", () => {
      const success = engine.loadFen("invalid fen string");
      expect(success).toBe(false);
    });
  });

  describe("handleResignation", () => {
    it("should handle white resignation", () => {
      const result = engine.handleResignation("w");
      expect(result.success).toBe(true);
      expect(result.isGameOver).toBe(true);
      expect(result.winner).toBe("black");
      expect(result.reason).toBe("resignation");
    });

    it("should handle black resignation", () => {
      const result = engine.handleResignation("b");
      expect(result.success).toBe(true);
      expect(result.winner).toBe("white");
    });
  });

  describe("handleDrawAgreement", () => {
    it("should handle draw by agreement", () => {
      const result = engine.handleDrawAgreement();
      expect(result.success).toBe(true);
      expect(result.isGameOver).toBe(true);
      expect(result.winner).toBe("draw");
      expect(result.reason).toBe("agreement");
    });
  });

  describe("handleTimeout", () => {
    it("should handle white timeout", () => {
      const result = engine.handleTimeout("w");
      expect(result.success).toBe(true);
      expect(result.winner).toBe("black");
      expect(result.reason).toBe("timeout");
    });
  });

  describe("reset", () => {
    it("should reset to starting position", () => {
      engine.validateMove("e2", "e4", undefined, "user1", "w");
      engine.reset();
      const state = engine.getGameState();
      expect(state.fen).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
      expect(state.history).toHaveLength(0);
    });
  });
});
