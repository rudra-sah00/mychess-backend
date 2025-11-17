import express from "express";
import http from "http";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { Server } from "socket.io";

import config from "./config/env";
import logger from "./config/logger";
import { registerChessNamespace } from "./modules/chess";
import authRoutes from "./routes/auth";

export const createHttpServer = () => {
  const app = express();

  // Security headers
  if (process.env.NODE_ENV === "production") {
    app.use(helmet());
    app.use(compression());
  }

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === "production" ? 100 : 1000,
    message: "Too many requests from this IP",
  });
  app.use("/api/", limiter);

  // Request logging
  app.use((req, _res, next) => {
    logger.info(`${req.method} ${req.path}`, {
      ip: req.ip,
      userAgent: req.get("user-agent"),
    });
    next();
  });

  app.use(cors({
    origin: ["http://localhost:5173", "http://localhost:3000"],
    credentials: true,
  }));
  app.use(express.json());
  app.use(cookieParser());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  app.use("/api/auth", authRoutes);

  const httpServer = http.createServer(app);

  const io = new Server(httpServer, {
    path: config.socketPath,
    cors: {
      origin: ["http://localhost:5173", "http://localhost:3000"],
      methods: ["GET", "POST"],
    },
  });

  registerChessNamespace(io);

  return { app, httpServer, io };
};
