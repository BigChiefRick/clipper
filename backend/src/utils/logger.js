const winston = require('winston');
const path = require('path');

// Define log levels
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

// Define log colors
const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue'
};

// Add colors to winston
winston.addColors(logColors);

// Create custom format
const customFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    
    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }
    
    // Add stack trace for errors
    if (stack) {
      log += `\n${stack}`;
    }
    
    return log;
  })
);

// Create console format with colors
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  customFormat
);

// Determine log level from environment
const logLevel = process.env.LOG_LEVEL || 'info';

// Create transports array
const transports = [
  // Console transport
  new winston.transports.Console({
    level: logLevel,
    format: consoleFormat,
    handleExceptions: true,
    handleRejections: true
  })
];

// Add file transports in production or if specified
if (process.env.NODE_ENV === 'production' || process.env.LOG_TO_FILE === 'true') {
  // Ensure logs directory exists
  const logsDir = path.join(process.cwd(), 'logs');
  
  // Error log file
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: customFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      handleExceptions: true,
      handleRejections: true
    })
  );

  // Combined log file
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      level: logLevel,
      format: customFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  );

  // Access log file for HTTP requests
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'access.log'),
      level: 'info',
      format: customFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 3
    })
  );
}

// Create logger instance
const logger = winston.createLogger({
  levels: logLevels,
  level: logLevel,
  format: customFormat,
  transports: transports,
  exitOnError: false
});

// Handle uncaught exceptions and unhandled rejections
logger.exceptions.handle(
  new winston.transports.Console({
    format: consoleFormat
  })
);

logger.rejections.handle(
  new winston.transports.Console({
    format: consoleFormat
  })
);

// Add custom methods for specific use cases
logger.request = (req, res, responseTime) => {
  const { method, url, ip } = req;
  const { statusCode } = res;
  const userAgent = req.get('User-Agent');
  
  logger.info('HTTP Request', {
    method,
    url,
    statusCode,
    responseTime: `${responseTime}ms`,
    ip,
    userAgent
  });
};

logger.apiCall = (service, endpoint, statusCode, responseTime, error = null) => {
  const level = error ? '
