import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// LogLevel enum
export const LogLevel = Object.freeze({
  DEBUG: 'DEBUG',
  WARNING: 'WARNING',
  ERROR: 'ERROR'
});

// LogLevel priority for comparison
const LOG_LEVEL_PRIORITY = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.WARNING]: 1,
  [LogLevel.ERROR]: 2
};

/**
 * Logger class for writing structured logs to files
 */
export class Logger {
  constructor(serviceName = 'jira-server') {
    this.serviceName = serviceName;
    this.logLevel = this.getLogLevelFromEnv();
    this.logsDir = path.join(path.dirname(__dirname), 'logs');
    this.logFilePath = this.initializeLogFile();
    this.writeStream = null;
    this.initializeWriteStream();
  }

  /**
   * Get log level from environment variable
   * @returns {string} The configured log level
   */
  getLogLevelFromEnv() {
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    return Object.values(LogLevel).includes(envLevel) ? envLevel : LogLevel.DEBUG;
  }

  /**
   * Initialize log file and directory
   * @returns {string} Path to the log file
   */
  initializeLogFile() {
    // Create logs directory if it doesn't exist
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }

    // Generate log file name with local date timestamp
    const now = new Date();
    const timestamp = now.getFullYear() + '-' + 
      String(now.getMonth() + 1).padStart(2, '0') + '-' + 
      String(now.getDate()).padStart(2, '0'); // YYYY-MM-DD format in local timezone
    const filename = `${this.serviceName}-${timestamp}.log`;
    return path.join(this.logsDir, filename);
  }

  /**
   * Initialize write stream for efficient file writing
   */
  initializeWriteStream() {
    this.writeStream = fs.createWriteStream(this.logFilePath, { flags: 'a' });
    this.writeStream.on('error', (error) => {
      console.error('Logger write stream error:', error);
    });
  }

  /**
   * Check if a log level should be logged based on current configuration
   * @param {string} level - The log level to check
   * @returns {boolean} Whether the level should be logged
   */
  shouldLog(level) {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.logLevel];
  }

  /**
   * Mask sensitive data in log messages
   * @param {any} data - Data to mask
   * @returns {any} Masked data
   */
  maskSensitiveData(data) {
    if (typeof data === 'string') {
      // Mask API tokens and passwords
      return data
        .replace(/([Aa]pi[_-]?[Tt]oken["\s:=]+)([^\s",}]+)/g, '$1***MASKED***')
        .replace(/([Pp]assword["\s:=]+)([^\s",}]+)/g, '$1***MASKED***')
        .replace(/([Tt]oken["\s:=]+)([^\s",}]+)/g, '$1***MASKED***')
        .replace(/([Aa]uthorization["\s:]+)(Basic|Bearer)\s+([^\s",}]+)/gi, '$1$2 ***MASKED***');
    }
    
    if (typeof data === 'object' && data !== null) {
      const masked = Array.isArray(data) ? [...data] : { ...data };
      const sensitiveKeys = ['password', 'token', 'apitoken', 'api_token', 'authorization', 'secret'];
      
      for (const key in masked) {
        if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
          masked[key] = '***MASKED***';
        } else if (typeof masked[key] === 'object') {
          masked[key] = this.maskSensitiveData(masked[key]);
        } else if (typeof masked[key] === 'string') {
          masked[key] = this.maskSensitiveData(masked[key]);
        }
      }
      return masked;
    }
    
    return data;
  }

  /**
   * Truncate large data for logging
   * @param {any} data - Data to truncate
   * @param {number} maxLength - Maximum string length
   * @returns {any} Truncated data
   */
  truncateData(data, maxLength = 1000) {
    if (typeof data === 'string' && data.length > maxLength) {
      return `${data.substring(0, maxLength)}... [truncated ${data.length - maxLength} characters]`;
    }
    
    if (typeof data === 'object' && data !== null) {
      const stringified = JSON.stringify(data);
      if (stringified.length > maxLength) {
        try {
          // Try to preserve structure while truncating
          const truncated = JSON.stringify(data, null, 2).substring(0, maxLength);
          return `${truncated}... [truncated object]`;
        } catch {
          return `[Large object truncated - ${stringified.length} characters]`;
        }
      }
    }
    
    return data;
  }

  /**
   * Format log entry
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {object} metadata - Additional metadata
   * @returns {string} Formatted log entry
   */
  formatLogEntry(level, message, metadata = {}) {
    const timestamp = new Date().toISOString();
    const maskedMetadata = this.maskSensitiveData(metadata);
    const truncatedMetadata = this.truncateData(maskedMetadata);
    
    const logEntry = {
      timestamp,
      level,
      service: this.serviceName,
      message: this.maskSensitiveData(message),
      ...(Object.keys(truncatedMetadata).length > 0 && { metadata: truncatedMetadata })
    };

    return JSON.stringify(logEntry) + '\n';
  }

  /**
   * Write log entry to file
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {object} metadata - Additional metadata
   */
  async writeLog(level, message, metadata = {}) {
    if (!this.shouldLog(level)) {
      return;
    }

    const logEntry = this.formatLogEntry(level, message, metadata);
    
    return new Promise((resolve) => {
      if (this.writeStream && !this.writeStream.destroyed) {
        this.writeStream.write(logEntry, (error) => {
          if (error) {
            console.error('Failed to write log:', error);
          }
          resolve();
        });
      } else {
        // Fallback to synchronous write if stream is not available
        try {
          fs.appendFileSync(this.logFilePath, logEntry);
        } catch (error) {
          console.error('Failed to write log synchronously:', error);
        }
        resolve();
      }
    });
  }

  /**
   * Log debug message
   * @param {string} message - Debug message
   * @param {object} metadata - Additional metadata
   */
  async debug(message, metadata = {}) {
    await this.writeLog(LogLevel.DEBUG, message, metadata);
  }

  /**
   * Log warning message
   * @param {string} message - Warning message
   * @param {object} metadata - Additional metadata
   */
  async warning(message, metadata = {}) {
    await this.writeLog(LogLevel.WARNING, message, metadata);
  }

  /**
   * Log error message
   * @param {string} message - Error message
   * @param {object} metadata - Additional metadata
   */
  async error(message, metadata = {}) {
    await this.writeLog(LogLevel.ERROR, message, metadata);
    
    // Also log to console.error for critical errors
    if (process.env.NODE_ENV !== 'test') {
      console.error(`[${this.serviceName}] ERROR: ${message}`);
    }
  }

  /**
   * Close the write stream
   */
  close() {
    if (this.writeStream && !this.writeStream.destroyed) {
      this.writeStream.end();
    }
  }
}

// Create singleton instance
const logger = new Logger('jira-server');

// Handle process termination
process.on('exit', () => {
  logger.close();
});

process.on('SIGINT', () => {
  logger.close();
  process.exit();
});

process.on('SIGTERM', () => {
  logger.close();
  process.exit();
});

export default logger;