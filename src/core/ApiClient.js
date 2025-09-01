import fetch from 'node-fetch';

/**
 * Base API client class with common HTTP functionality
 * Provides retry logic, error handling, and request/response interceptors
 */
export class ApiClient {
  constructor(config) {
    this.baseUrl = config.baseUrl;
    this.auth = config.auth;
    this.maxRetries = config.maxRetries || 3;
    this.retryDelay = config.retryDelay || 1000;
    this.timeout = config.timeout || 30000;
    this.requestInterceptors = [];
    this.responseInterceptors = [];
    
    // Rate limiting
    this.rateLimitDelay = config.rateLimitDelay || 0;
    this.lastRequestTime = 0;
    
    // Cache for API responses (optional)
    this.cache = config.enableCache ? new Map() : null;
    this.cacheTimeout = config.cacheTimeout || 5 * 60 * 1000; // 5 minutes default
  }
  
  /**
   * Get authentication headers
   * @returns {Object} - Auth headers
   */
  getAuthHeaders() {
    if (this.auth.type === 'basic') {
      const authString = Buffer.from(`${this.auth.email}:${this.auth.token}`).toString('base64');
      return {
        'Authorization': `Basic ${authString}`,
      };
    }
    throw new Error(`Unsupported auth type: ${this.auth.type}`);
  }
  
  /**
   * Get default headers
   * @returns {Object} - Default headers
   */
  getDefaultHeaders() {
    return {
      ...this.getAuthHeaders(),
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };
  }
  
  /**
   * Add request interceptor
   * @param {Function} interceptor - Function to process request before sending
   */
  addRequestInterceptor(interceptor) {
    this.requestInterceptors.push(interceptor);
  }
  
  /**
   * Add response interceptor
   * @param {Function} interceptor - Function to process response after receiving
   */
  addResponseInterceptor(interceptor) {
    this.responseInterceptors.push(interceptor);
  }
  
  /**
   * Apply request interceptors
   * @param {Object} config - Request configuration
   * @returns {Object} - Modified configuration
   */
  async applyRequestInterceptors(config) {
    let modifiedConfig = { ...config };
    for (const interceptor of this.requestInterceptors) {
      modifiedConfig = await interceptor(modifiedConfig);
    }
    return modifiedConfig;
  }
  
  /**
   * Apply response interceptors
   * @param {Response} response - HTTP response
   * @returns {Response} - Modified response
   */
  async applyResponseInterceptors(response) {
    let modifiedResponse = response;
    for (const interceptor of this.responseInterceptors) {
      modifiedResponse = await interceptor(modifiedResponse);
    }
    return modifiedResponse;
  }
  
  /**
   * Apply rate limiting
   */
  async applyRateLimit() {
    if (this.rateLimitDelay > 0) {
      const timeSinceLastRequest = Date.now() - this.lastRequestTime;
      if (timeSinceLastRequest < this.rateLimitDelay) {
        const delay = this.rateLimitDelay - timeSinceLastRequest;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      this.lastRequestTime = Date.now();
    }
  }
  
  /**
   * Get cached response if available
   * @param {string} cacheKey - Cache key
   * @returns {*} - Cached response or null
   */
  getCached(cacheKey) {
    if (!this.cache) return null;
    
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    
    // Remove expired cache entry
    if (cached) {
      this.cache.delete(cacheKey);
    }
    
    return null;
  }
  
  /**
   * Set cached response
   * @param {string} cacheKey - Cache key
   * @param {*} data - Data to cache
   */
  setCached(cacheKey, data) {
    if (this.cache) {
      this.cache.set(cacheKey, {
        data,
        timestamp: Date.now(),
      });
    }
  }
  
  /**
   * Make HTTP request with retry logic
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Request options
   * @returns {Promise<*>} - Response data
   */
  async request(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;
    
    // Check cache for GET requests
    if (options.method === 'GET' || !options.method) {
      const cacheKey = `${url}:${JSON.stringify(options)}`;
      const cached = this.getCached(cacheKey);
      if (cached) {
        return cached;
      }
    }
    
    // Apply rate limiting
    await this.applyRateLimit();
    
    // Prepare request configuration
    let config = {
      headers: this.getDefaultHeaders(),
      timeout: this.timeout,
      ...options,
    };
    
    // Apply request interceptors
    config = await this.applyRequestInterceptors(config);
    
    // Retry logic
    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.timeout);
        
        try {
          // Make request
          let response = await fetch(url, {
            ...config,
            signal: controller.signal,
          });
          
          clearTimeout(timeoutId);
          
          // Apply response interceptors
          response = await this.applyResponseInterceptors(response);
          
          // Check response status
          if (!response.ok) {
            throw new ApiError(
              `API request failed: ${response.status} ${response.statusText}`,
              response.status,
              await this.parseErrorResponse(response)
            );
          }
          
          // Parse response
          const data = await this.parseResponse(response);
          
          // Cache successful GET requests
          if (config.method === 'GET' || !config.method) {
            const cacheKey = `${url}:${JSON.stringify(options)}`;
            this.setCached(cacheKey, data);
          }
          
          return data;
          
        } catch (error) {
          clearTimeout(timeoutId);
          
          if (error.name === 'AbortError') {
            throw new ApiError('Request timeout', 'TIMEOUT', null);
          }
          throw error;
        }
        
      } catch (error) {
        lastError = error;
        
        // Don't retry for certain error types
        if (error.status && error.status < 500 && error.status !== 429) {
          throw error;
        }
        
        // Wait before retry
        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt); // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }
  
  /**
   * Parse response based on content type
   * @param {Response} response - HTTP response
   * @returns {Promise<*>} - Parsed response
   */
  async parseResponse(response) {
    const contentType = response.headers.get('content-type');
    
    if (contentType && contentType.includes('application/json')) {
      return await response.json();
    }
    
    return await response.text();
  }
  
  /**
   * Parse error response
   * @param {Response} response - HTTP error response
   * @returns {Promise<*>} - Parsed error
   */
  async parseErrorResponse(response) {
    try {
      const contentType = response.headers.get('content-type');
      
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      }
      
      return await response.text();
    } catch {
      return null;
    }
  }
  
  /**
   * GET request
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Additional options
   * @returns {Promise<*>} - Response data
   */
  async get(endpoint, options = {}) {
    return this.request(endpoint, {
      method: 'GET',
      ...options,
    });
  }
  
  /**
   * POST request
   * @param {string} endpoint - API endpoint
   * @param {*} data - Request body
   * @param {Object} options - Additional options
   * @returns {Promise<*>} - Response data
   */
  async post(endpoint, data, options = {}) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
      ...options,
    });
  }
  
  /**
   * PUT request
   * @param {string} endpoint - API endpoint
   * @param {*} data - Request body
   * @param {Object} options - Additional options
   * @returns {Promise<*>} - Response data
   */
  async put(endpoint, data, options = {}) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
      ...options,
    });
  }
  
  /**
   * DELETE request
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Additional options
   * @returns {Promise<*>} - Response data
   */
  async delete(endpoint, options = {}) {
    return this.request(endpoint, {
      method: 'DELETE',
      ...options,
    });
  }
  
  /**
   * Clear cache
   */
  clearCache() {
    if (this.cache) {
      this.cache.clear();
    }
  }
}

/**
 * Custom API error class
 */
export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}