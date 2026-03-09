import { createClient } from "redis";
import config from "../../config/env";
import logger from "../../config/logger";

const redisClient = createClient({
    url: config.redisUrl,
    socket: {
        reconnectStrategy: (retries: number) => {
            const delay = Math.min(retries * 200, 5000);
            logger.warn(`Redis: reconnecting in ${delay}ms (attempt ${retries + 1})`);
            return delay; // never give up
        },
    },
});

redisClient.on("error", (err) => logger.error("Redis Client Error", err));
redisClient.on("connect", () => logger.info("Redis Client Connected"));
redisClient.on("reconnecting", () => logger.warn("Redis Client Reconnecting..."));
redisClient.on("ready", () => logger.info("Redis Client Ready"));

export const initRedis = async () => {
    await redisClient.connect();
};

export default redisClient;
