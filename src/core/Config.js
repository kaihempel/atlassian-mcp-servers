/**
 * Configuration management class
 * Handles environment variables, validation, and defaults
 */
export class Config {
  constructor(service, envVars = process.env) {
    this.service = service;
    this.envVars = envVars;
    this.config = {};
    
    this.loadConfiguration();
    this.validateConfiguration();
  }
  
  /**
   * Load configuration based on service type
   */
  loadConfiguration() {
    switch (this.service) {
      case 'confluence':
        this.loadConfluenceConfig();
        break;
      case 'jira':
        this.loadJiraConfig();
        break;
      default:
        throw new Error(`Unknown service: ${this.service}`);
    }
    
    // Load common configuration
    this.loadCommonConfig();
  }
  
  /**
   * Load Confluence-specific configuration
   */
  loadConfluenceConfig() {
    this.config = {
      ...this.config,
      url: this.envVars.CONFLUENCE_URL,
      email: this.envVars.CONFLUENCE_EMAIL,
      apiToken: this.envVars.CONFLUENCE_API_TOKEN,
      serverName: 'confluence-mcp-server',
      serverVersion: '0.1.0',
      
      // API settings
      apiVersion: this.envVars.CONFLUENCE_API_VERSION || 'auto', // 'v1', 'v2', or 'auto'
      apiTimeout: parseInt(this.envVars.CONFLUENCE_API_TIMEOUT) || 30000,
      apiRetries: parseInt(this.envVars.CONFLUENCE_API_RETRIES) || 3,
      apiRateLimit: parseInt(this.envVars.CONFLUENCE_API_RATE_LIMIT) || 0,
      
      // Cache settings
      enableCache: this.envVars.CONFLUENCE_ENABLE_CACHE !== 'false',
      cacheTimeout: parseInt(this.envVars.CONFLUENCE_CACHE_TIMEOUT) || 300000, // 5 minutes
      
      // Feature flags
      features: {
        v2ApiEnabled: this.envVars.CONFLUENCE_V2_API_ENABLED !== 'false',
        parallelProcessing: this.envVars.CONFLUENCE_PARALLEL_PROCESSING !== 'false',
        debugMode: this.envVars.CONFLUENCE_DEBUG === 'true',
      },
    };
  }
  
  /**
   * Load Jira-specific configuration
   */
  loadJiraConfig() {
    this.config = {
      ...this.config,
      url: this.envVars.JIRA_URL,
      email: this.envVars.JIRA_EMAIL,
      apiToken: this.envVars.JIRA_API_TOKEN,
      username: this.envVars.JIRA_USERNAME || this.envVars.JIRA_EMAIL,
      serverName: 'jira-mcp-server',
      serverVersion: '0.1.0',
      
      // API settings
      apiVersion: this.envVars.JIRA_API_VERSION || '3',
      apiTimeout: parseInt(this.envVars.JIRA_API_TIMEOUT) || 30000,
      apiRetries: parseInt(this.envVars.JIRA_API_RETRIES) || 3,
      apiRateLimit: parseInt(this.envVars.JIRA_API_RATE_LIMIT) || 0,
      
      // Cache settings
      enableCache: this.envVars.JIRA_ENABLE_CACHE !== 'false',
      cacheTimeout: parseInt(this.envVars.JIRA_CACHE_TIMEOUT) || 300000, // 5 minutes
      
      // Feature flags
      features: {
        agileApiEnabled: this.envVars.JIRA_AGILE_API_ENABLED !== 'false',
        parallelProcessing: this.envVars.JIRA_PARALLEL_PROCESSING !== 'false',
        debugMode: this.envVars.JIRA_DEBUG === 'true',
      },
    };
  }
  
  /**
   * Load common configuration
   */
  loadCommonConfig() {
    this.config = {
      ...this.config,
      
      // Logging
      logLevel: this.envVars.LOG_LEVEL || 'info',
      logFormat: this.envVars.LOG_FORMAT || 'json',
      
      // Performance
      maxConcurrentRequests: parseInt(this.envVars.MAX_CONCURRENT_REQUESTS) || 5,
      requestTimeout: parseInt(this.envVars.REQUEST_TIMEOUT) || 30000,
      
      // Task extraction settings (for Confluence)
      taskMinLength: parseInt(this.envVars.TASK_MIN_LENGTH) || 3,
      taskMaxLength: parseInt(this.envVars.TASK_MAX_LENGTH) || 500,
      maxTasksPerPage: parseInt(this.envVars.MAX_TASKS_PER_PAGE) || 5,
      
      // Default limits
      defaultLimit: parseInt(this.envVars.DEFAULT_RESULT_LIMIT) || 25,
      maxLimit: parseInt(this.envVars.MAX_RESULT_LIMIT) || 100,
    };
  }
  
  /**
   * Validate required configuration
   */
  validateConfiguration() {
    const required = ['url', 'email', 'apiToken'];
    const missing = [];
    
    for (const field of required) {
      if (!this.config[field]) {
        missing.push(field);
      }
    }
    
    if (missing.length > 0) {
      const envPrefix = this.service.toUpperCase();
      const missingEnvVars = missing.map(field => {
        switch (field) {
          case 'url':
            return `${envPrefix}_URL`;
          case 'email':
            return `${envPrefix}_EMAIL`;
          case 'apiToken':
            return `${envPrefix}_API_TOKEN`;
          default:
            return `${envPrefix}_${field.toUpperCase()}`;
        }
      });
      
      throw new Error(
        `Missing required environment variables: ${missingEnvVars.join(', ')}`
      );
    }
    
    // Validate URL format
    try {
      new URL(this.config.url);
    } catch {
      throw new Error(`Invalid URL format: ${this.config.url}`);
    }
    
    // Validate email format
    if (!this.isValidEmail(this.config.email)) {
      throw new Error(`Invalid email format: ${this.config.email}`);
    }
    
    // Validate numeric values
    this.validateNumericRange('apiTimeout', 1000, 300000);
    this.validateNumericRange('apiRetries', 0, 10);
    this.validateNumericRange('maxConcurrentRequests', 1, 50);
    this.validateNumericRange('defaultLimit', 1, 1000);
    this.validateNumericRange('maxLimit', 1, 1000);
  }
  
  /**
   * Validate email format
   * @param {string} email - Email to validate
   * @returns {boolean} - True if valid
   */
  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
  
  /**
   * Validate numeric value is within range
   * @param {string} field - Field name
   * @param {number} min - Minimum value
   * @param {number} max - Maximum value
   */
  validateNumericRange(field, min, max) {
    const value = this.config[field];
    if (value !== undefined && (value < min || value > max)) {
      throw new Error(
        `Configuration value ${field} must be between ${min} and ${max}, got ${value}`
      );
    }
  }
  
  /**
   * Get configuration value
   * @param {string} key - Configuration key (supports dot notation)
   * @returns {*} - Configuration value
   */
  get(key) {
    if (!key) {
      return this.config;
    }
    
    const keys = key.split('.');
    let value = this.config;
    
    for (const k of keys) {
      value = value?.[k];
      if (value === undefined) {
        return undefined;
      }
    }
    
    return value;
  }
  
  /**
   * Set configuration value
   * @param {string} key - Configuration key (supports dot notation)
   * @param {*} value - Value to set
   */
  set(key, value) {
    const keys = key.split('.');
    const lastKey = keys.pop();
    
    let target = this.config;
    for (const k of keys) {
      if (!(k in target)) {
        target[k] = {};
      }
      target = target[k];
    }
    
    target[lastKey] = value;
  }
  
  /**
   * Check if feature is enabled
   * @param {string} feature - Feature name
   * @returns {boolean} - True if enabled
   */
  isFeatureEnabled(feature) {
    return this.config.features?.[feature] === true;
  }
  
  /**
   * Get API client configuration
   * @returns {Object} - API client config
   */
  getApiClientConfig() {
    return {
      baseUrl: this.config.url,
      auth: {
        type: 'basic',
        email: this.config.email,
        token: this.config.apiToken,
      },
      timeout: this.config.apiTimeout,
      maxRetries: this.config.apiRetries,
      rateLimitDelay: this.config.apiRateLimit,
      enableCache: this.config.enableCache,
      cacheTimeout: this.config.cacheTimeout,
    };
  }
  
  /**
   * Export configuration as environment variables
   * @returns {Object} - Environment variables
   */
  toEnvVars() {
    const prefix = this.service.toUpperCase();
    const envVars = {};
    
    const flattenConfig = (obj, parentKey = '') => {
      for (const [key, value] of Object.entries(obj)) {
        const envKey = parentKey ? `${parentKey}_${key.toUpperCase()}` : key.toUpperCase();
        
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          flattenConfig(value, envKey);
        } else {
          envVars[`${prefix}_${envKey}`] = String(value);
        }
      }
    };
    
    flattenConfig(this.config);
    return envVars;
  }
}