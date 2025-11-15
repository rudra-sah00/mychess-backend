import config from "./config/env";
import logger from "./config/logger";
import { createHttpServer } from "./app";

const { httpServer } = createHttpServer();

httpServer.listen(config.port, () => {
  logger.info(`Socket.IO server listening on port ${config.port}`);
});
