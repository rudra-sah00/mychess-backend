import { BotService, BotManager } from '../BotService';

describe('BotService', () => {
  let botService: BotService;

  beforeEach(() => {
    botService = new BotService('medium');
  });

  afterEach(() => {
    if (botService) {
      botService.terminate();
    }
  });

  describe('initialization', () => {
    it('should initialize with correct difficulty', () => {
      expect(botService.getDifficulty()).toBe('medium');
      expect(botService.ready()).toBe(false);
    });

    it('should initialize Stockfish engine', async () => {
      await botService.initialize();
      expect(botService.ready()).toBe(true);
    }, 10000);
  });

  describe('difficulty levels', () => {
    it('should create easy bot', () => {
      const easyBot = new BotService('easy');
      expect(easyBot.getDifficulty()).toBe('easy');
      easyBot.terminate();
    });

    it('should create medium bot', () => {
      const mediumBot = new BotService('medium');
      expect(mediumBot.getDifficulty()).toBe('medium');
      mediumBot.terminate();
    });

    it('should create hard bot', () => {
      const hardBot = new BotService('hard');
      expect(hardBot.getDifficulty()).toBe('hard');
      hardBot.terminate();
    });
  });

  describe('move generation', () => {
    beforeEach(async () => {
      await botService.initialize();
    }, 10000);

    it('should generate valid move for starting position', async () => {
      const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      const move = await botService.getBestMove(startFen);

      expect(move).toBeTruthy();
      expect(typeof move).toBe('string');
      expect(move.length).toBeGreaterThanOrEqual(4);
    }, 15000);

    it('should throw error if engine not ready', async () => {
      const uninitializedBot = new BotService('easy');
      const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

      await expect(uninitializedBot.getBestMove(startFen)).rejects.toThrow('Stockfish engine not ready');
      uninitializedBot.terminate();
    });
  });

  describe('termination', () => {
    it('should terminate engine', async () => {
      await botService.initialize();
      expect(botService.ready()).toBe(true);

      botService.terminate();
      expect(botService.ready()).toBe(false);
    }, 10000);
  });
});

describe('BotManager', () => {
  let botManager: BotManager;

  beforeEach(() => {
    botManager = new BotManager();
  });

  afterEach(() => {
    botManager.terminateAll();
  });

  describe('bot lifecycle', () => {
    it('should create bot for game', async () => {
      const gameId = 'test-game-1';
      const bot = await botManager.createBot(gameId, 'easy');

      expect(bot).toBeTruthy();
      expect(bot.getDifficulty()).toBe('easy');
      expect(botManager.getBot(gameId)).toBe(bot);
    }, 10000);

    it('should return existing bot if already created', async () => {
      const gameId = 'test-game-2';
      const bot1 = await botManager.createBot(gameId, 'medium');
      const bot2 = await botManager.createBot(gameId, 'hard'); // Should return bot1

      expect(bot2).toBe(bot1);
      expect(bot2.getDifficulty()).toBe('medium'); // Original difficulty preserved
    }, 10000);

    it('should get bot for game', async () => {
      const gameId = 'test-game-3';
      await botManager.createBot(gameId, 'hard');

      const bot = botManager.getBot(gameId);
      expect(bot).toBeTruthy();
      expect(bot?.getDifficulty()).toBe('hard');
    }, 10000);

    it('should remove bot for game', async () => {
      const gameId = 'test-game-4';
      await botManager.createBot(gameId, 'easy');

      expect(botManager.getBot(gameId)).toBeTruthy();

      botManager.removeBot(gameId);
      expect(botManager.getBot(gameId)).toBeUndefined();
    }, 10000);

    it('should track active bot games', async () => {
      await botManager.createBot('game-1', 'easy');
      await botManager.createBot('game-2', 'medium');
      await botManager.createBot('game-3', 'hard');

      const activeGames = botManager.getActiveBotGames();
      expect(activeGames).toHaveLength(3);
      expect(activeGames).toContain('game-1');
      expect(activeGames).toContain('game-2');
      expect(activeGames).toContain('game-3');
    }, 15000);

    it('should terminate all bots', async () => {
      await botManager.createBot('game-1', 'easy');
      await botManager.createBot('game-2', 'medium');

      expect(botManager.getActiveBotGames()).toHaveLength(2);

      botManager.terminateAll();
      expect(botManager.getActiveBotGames()).toHaveLength(0);
    }, 10000);
  });
});
