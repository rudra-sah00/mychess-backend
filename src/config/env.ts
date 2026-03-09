import dotenv from "dotenv";

dotenv.config();

const config = {
  port: parseInt(process.env.PORT || "8080", 10),
  socketPath: process.env.SOCKET_IO_PATH || "/socket.io/",
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  jwt: {
    secret: process.env.JWT_SECRET || "default_development_secret",
    expiresIn: process.env.JWT_EXPIRES_IN || "14d",
  },
};

export default config;
