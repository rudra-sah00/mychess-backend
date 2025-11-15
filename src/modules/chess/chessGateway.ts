import { Server, Socket } from "socket.io";
import logger from "../../config/logger";

export const registerChessNamespace = (io: Server) => {
  const namespace = io.of("/chess");

  namespace.on("connection", (socket: Socket) => {
    socket.data.username = socket.handshake.query.username || `guest-${socket.id.slice(0, 4)}`;
    logger.info(`Chess namespace connection: ${socket.data.username} (${socket.id})`);

    socket.on("join-room", (room: string) => {
      const target = room || "lobby";
      socket.join(target);
      socket.emit("joined-room", target);
      socket.to(target).emit("player-joined", {
        player: socket.data.username,
        room: target,
      });
      logger.debug(`${socket.data.username} joined room: ${target}`);
    });

    socket.on("move", (payload: { room: string; move: string }) => {
      if (!payload?.room || !payload?.move) {
        socket.emit("invalid-move", "room and move are required");
        logger.warn(`Invalid move from ${socket.data.username}`);
        return;
      }
      namespace.to(payload.room).emit("move", {
        player: socket.data.username,
        move: payload.move,
        ts: Date.now(),
      });
      logger.debug(`Move in ${payload.room}: ${payload.move} by ${socket.data.username}`);
    });

    socket.on("disconnect", (reason: string) => {
      logger.info(`${socket.data.username} disconnected: ${reason}`);
      socket.rooms.forEach((room: string) => {
        if (room !== socket.id) {
          socket.to(room).emit("player-left", {
            player: socket.data.username,
            room,
            reason,
          });
        }
      });
    });
  });
};
