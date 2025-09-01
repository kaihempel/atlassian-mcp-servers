/**
 * Centralized error handling for MCP servers
 * Classifies errors and provides appropriate responses
 */
export class ErrorHandler {
  constructor(options = {}) {
    this.logErrors = options.logErrors !== false;
    this.includeStackTrace = options.includeStackTrace === true;
    this.errorMap = new Map();
    
    this.setupDefaultErrorMappings();
  }
  
  /**
   * Setup default error mappings
   */
  setupDefaultErrorMappings() {
    // API errors
    this.registerError('ApiError', this.handleApiError);
    this.registerError('NetworkError', this.handleNetworkError);
    this.registerError('TimeoutError', this.handleTimeoutError);
    
    // Validation errors
    this.registerError('ValidationError', this.handleValidationError);
    this.registerError('TypeError', this.handleTypeError);
    
    // Auth errors
    this.registerError('AuthenticationError', this.handleAuthError);
    this.registerError('AuthorizationError', this.handleAuthError);
    
    // Resource errors
    this.registerError('NotFoundError', this.handleNotFoundError);
    this.registerError('ConflictError', this.handleConflictError);
    
    // Rate limiting
    this.registerError('RateLimitError', this.handleRateLimitError);
  }
  
  /**
   * Register custom error handler
   * @param {string} errorType - Error type/name
   * @param {Function} handler - Error handler function
   */
  registerError(errorType, handler) {
    this.errorMap.set(errorType, handler);
  }
  
  /**
   * Handle error and return formatted response
   * @param {Error} error - Error to handle
   * @returns {Object} - Formatted error object
   */
  handle(error) {
    if (this.logErrors) {
      this.logError(error);
    }
    
    // Get specific handler for error type
    const handler = this.errorMap.get(error.name) || this.errorMap.get(error.constructor.name);
    
    if (handler) {
      return handler.call(this, error);
    }
    
    // Default handling
    return this.handleGenericError(error);
  }
  
  /**
   * Log error details
   * @param {Error} error - Error to log
   */
  logError(error) {
    const timestamp = new Date().toISOString();
    const errorInfo = {
      timestamp,
      name: error.name,
      message: error.message,
      code: error.code || error.status,
    };
    
    if (this.includeStackTrace && error.stack) {
      errorInfo.stack = error.stack;
    }
    
    console.error('Error occurred:', JSON.stringify(errorInfo, null, 2));
  }
  
  /**
   * Handle API errors
   * @param {Error} error - API error
   * @returns {Object} - Formatted error
   */
  handleApiError(error) {
    const status = error.status || error.code;
    let message = error.message;
    let details = error.details || {};
    
    // Parse status codes
    if (status === 400) {
      message = `Bad Request: ${message}`;
    } else if (status === 401) {
      message = 'Authentication failed. Please check your API credentials.';
    } else if (status === 403) {
      message = 'Permission denied. You do not have access to this resource.';
    } else if (status === 404) {
      message = 'Resource not found. Please check the ID or URL.';
    } else if (status === 429) {
      message = 'Rate limit exceeded. Please try again later.';
      details.retryAfter = error.retryAfter;
    } else if (status >= 500) {
      message = 'Server error. The service is temporarily unavailable.';
    }
    
    return {
      name: 'ApiError',
      message,
      code: status,
      details,
      recoverable: status !== 401 && status !== 403,
    };
  }
  
  /**
   * Handle network errors
   * @param {Error} error - Network error
   * @returns {Object} - Formatted error
   */
  handleNetworkError(error) {
    return {
      name: 'NetworkError',
      message: 'Network error occurred. Please check your internet connection.',
      code: 'NETWORK_ERROR',
      details: {
        originalMessage: error.message,
      },
      recoverable: true,
    };
  }
  
  /**
   * Handle timeout errors
   * @param {Error} error - Timeout error
   * @returns {Object} - Formatted error
   */
  handleTimeoutError(error) {
    return {
      name: 'TimeoutError',
      message: 'Request timed out. The operation took too long to complete.',
      code: 'TIMEOUT',
      details: {
        timeout: error.timeout || 30000,
      },
      recoverable: true,
    };
  }
  
  /**
   * Handle validation errors
   * @param {Error} error - Validation error
   * @returns {Object} - Formatted error
   */
  handleValidationError(error) {
    return {
      name: 'ValidationError',
      message: error.message || 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: error.details || {},
      recoverable: false,
    };
  }
  
  /**
   * Handle type errors
   * @param {Error} error - Type error
   * @returns {Object} - Formatted error
   */
  handleTypeError(error) {
    return {
      name: 'TypeError',
      message: `Type error: ${error.message}`,
      code: 'TYPE_ERROR',
      details: {},
      recoverable: false,
    };
  }
  
  /**
   * Handle authentication/authorization errors
   * @param {Error} error - Auth error
   * @returns {Object} - Formatted error
   */
  handleAuthError(error) {
    return {
      name: error.name,
      message: error.message || 'Authentication failed',
      code: 'AUTH_ERROR',
      details: {
        hint: 'Please check your API credentials in the environment variables',
      },
      recoverable: false,
    };
  }
  
  /**
   * Handle not found errors
   * @param {Error} error - Not found error
   * @returns {Object} - Formatted error
   */
  handleNotFoundError(error) {
    return {
      name: 'NotFoundError',
      message: error.message || 'Resource not found',
      code: 'NOT_FOUND',
      details: error.details || {},
      recoverable: false,
    };
  }
  
  /**
   * Handle conflict errors
   * @param {Error} error - Conflict error
   * @returns {Object} - Formatted error
   */
  handleConflictError(error) {
    return {
      name: 'ConflictError',
      message: error.message || 'Resource conflict',
      code: 'CONFLICT',
      details: error.details || {},
      recoverable: false,
    };
  }
  
  /**
   * Handle rate limit errors
   * @param {Error} error - Rate limit error
   * @returns {Object} - Formatted error
   */
  handleRateLimitError(error) {
    return {
      name: 'RateLimitError',
      message: 'Rate limit exceeded. Please wait before making more requests.',
      code: 'RATE_LIMIT',
      details: {
        retryAfter: error.retryAfter || 60,
        limit: error.limit,
        remaining: error.remaining || 0,
      },
      recoverable: true,
    };
  }
  
  /**
   * Handle generic errors
   * @param {Error} error - Generic error
   * @returns {Object} - Formatted error
   */
  handleGenericError(error) {
    const formatted = {
      name: error.name || 'Error',
      message: error.message || 'An unexpected error occurred',
      code: error.code || 'UNKNOWN_ERROR',
      details: {},
      recoverable: false,
    };
    
    if (this.includeStackTrace && error.stack) {
      formatted.details.stack = error.stack;
    }
    
    return formatted;
  }
  
  /**
   * Create error from status code
   * @param {number} status - HTTP status code
   * @param {string} message - Error message
   * @param {Object} details - Additional details
   * @returns {Error} - Created error
   */
  static createFromStatus(status, message, details = {}) {
    const error = new Error(message);
    error.name = 'ApiError';
    error.status = status;
    error.details = details;
    
    return error;
  }
  
  /**
   * Check if error is recoverable
   * @param {Error} error - Error to check
   * @returns {boolean} - True if recoverable
   */
  isRecoverable(error) {
    const handled = this.handle(error);
    return handled.recoverable === true;
  }
  
  /**
   * Wrap function with error handling
   * @param {Function} fn - Function to wrap
   * @returns {Function} - Wrapped function
   */
  wrap(fn) {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        throw this.handle(error);
      }
    };
  }
  
  /**
   * Create custom error class
   * @param {string} name - Error name
   * @param {string} defaultMessage - Default message
   * @returns {Class} - Error class
   */
  static createErrorClass(name, defaultMessage = '') {
    return class CustomError extends Error {
      constructor(message = defaultMessage, details = {}) {
        super(message);
        this.name = name;
        this.details = details;
        Error.captureStackTrace(this, this.constructor);
      }
    };
  }
}

// Export common error classes
export const ValidationError = ErrorHandler.createErrorClass('ValidationError', 'Validation failed');
export const AuthenticationError = ErrorHandler.createErrorClass('AuthenticationError', 'Authentication failed');
export const AuthorizationError = ErrorHandler.createErrorClass('AuthorizationError', 'Authorization failed');
export const NotFoundError = ErrorHandler.createErrorClass('NotFoundError', 'Resource not found');
export const ConflictError = ErrorHandler.createErrorClass('ConflictError', 'Resource conflict');
export const RateLimitError = ErrorHandler.createErrorClass('RateLimitError', 'Rate limit exceeded');
export const NetworkError = ErrorHandler.createErrorClass('NetworkError', 'Network error');
export const TimeoutError = ErrorHandler.createErrorClass('TimeoutError', 'Request timeout');