import config from "./config/env";
import logger from "./config/logger";
import { createHttpServer } from "./app";
import { gamePersistenceService } from "./services/persistence/GamePersistenceService";
import { initRedis } from "./services/redis/redisClient";

const { httpServer, io } = createHttpServer();

// Export io for use in GameManager
export { io };

initRedis()
  .then(() => logger.info("Redis connected"))
  .catch((err) => logger.error("Redis initial connect failed (will retry):", err));

httpServer.listen(config.port, () => {
  logger.info(`Socket.IO server listening on port ${config.port}`);

  // Start cleanup job for stale games (runs every 10 minutes)
  setInterval(async () => {
    try {
      await gamePersistenceService.cleanupStaleGames();
      logger.info('Periodic cleanup of stale games completed');
    } catch (error) {
      logger.error('Error during periodic cleanup:', error);
    }
  }, 600000); // 10 minutes

  logger.info('Game persistence cleanup job started');
});
