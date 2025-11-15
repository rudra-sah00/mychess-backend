import dotenv from "dotenv";

dotenv.config();

const config = {
  port: parseInt(process.env.PORT || "8080", 10),
  socketPath: process.env.SOCKET_IO_PATH || "/socket.io/",
};

export default config;
