import winston from "winston";

const isDevelopment = process.env.NODE_ENV !== "production";

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  isDevelopment
    ? winston.format.colorize()
    : winston.format.uncolorize(),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    return stack
      ? `${timestamp} [${level}]: ${message}\n${stack}`
      : `${timestamp} [${level}]: ${message}`;
  })
);

const logger = winston.createLogger({
  level: isDevelopment ? "debug" : "info",
  format: logFormat,
  transports: [
    new winston.transports.Console({
      stderrLevels: ["error"],
    }),
  ],
});

// Add file transports in production
if (!isDevelopment) {
  logger.add(
    new winston.transports.File({
      filename: "logs/error.log",
      level: "error",
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
  logger.add(
    new winston.transports.File({
      filename: "logs/combined.log",
      maxsize: 5242880,
      maxFiles: 5,
    })
  );
}

export default logger;
