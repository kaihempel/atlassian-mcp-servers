#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// LogLevel enum
const LogLevel = Object.freeze({
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
class Logger {
  constructor(serviceName = 'confluence-server') {
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

// Create singleton logger instance
const logger = new Logger('confluence-server');

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

class ConfluenceMCPServer {
  // Constants for task extraction
  static TASK_MIN_LENGTH = 3;
  static TASK_MAX_LENGTH = 500;
  static MAX_TASKS_PER_PAGE = 5;
  
  constructor() {
    this.server = new Server(
        {
          name: 'confluence-mcp-server',
          version: '0.1.0',
        },
        {
          capabilities: {
            tools: {},
          },
        }
    );

    // Configuration from environment variables
    this.confluenceUrl = process.env.CONFLUENCE_URL; // e.g., https://yourcompany.atlassian.net/wiki
    this.confluenceEmail = process.env.CONFLUENCE_EMAIL;
    this.confluenceApiToken = process.env.CONFLUENCE_API_TOKEN;

    if (!this.confluenceUrl || !this.confluenceEmail || !this.confluenceApiToken) {
      logger.error('Missing required environment variables: CONFLUENCE_URL, CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN');
      console.error('Missing required environment variables: CONFLUENCE_URL, CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN');
      process.exit(1);
    }
    
    // Normalize the Confluence URL
    this.normalizeConfluenceUrl();
    
    // Log initialization
    logger.debug('Initialized Confluence MCP Server', {
      baseUrl: this.confluenceUrl,
      email: this.confluenceEmail
    })
    
    // Cache for API version availability
    this._v2ApiAvailable = null;

    this.setupToolHandlers();
  }

  normalizeConfluenceUrl() {
    // Remove trailing slash if present
    this.confluenceUrl = this.confluenceUrl.replace(/\/$/, '');
    
    // Remove /wiki suffix if present (will be added as needed)
    this.confluenceUrl = this.confluenceUrl.replace(/\/wiki$/, '');
  }

  getAuthHeaders() {
    const auth = Buffer.from(`${this.confluenceEmail}:${this.confluenceApiToken}`).toString('base64');
    return {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'search_pages',
          description: 'Search Confluence pages by title or content',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query string',
              },
              spaceKey: {
                type: 'string',
                description: 'Limit search to specific space',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results (default: 25)',
                default: 25,
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'get_page_content',
          description: 'Get full content of a specific page',
          inputSchema: {
            type: 'object',
            properties: {
              pageId: {
                type: 'string',
                description: 'Confluence page ID',
              },
            },
            required: ['pageId'],
          },
        },
        {
          name: 'get_recent_pages',
          description: 'Get recently created or updated pages',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Maximum number of results (default: 25)',
                default: 25,
              },
              spaceKey: {
                type: 'string',
                description: 'Limit to specific space',
              },
            },
          },
        },
        {
          name: 'get_my_pages',
          description: 'Get pages created or modified by the current user',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Maximum number of results (default: 25)',
                default: 25,
              },
            },
          },
        },
        {
          name: 'get_page_tasks',
          description: 'Extract tasks and action items from Confluence pages',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search for pages containing task-related keywords',
                default: 'task OR action OR todo OR meeting',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of pages to analyze (default: 15)',
                default: 15,
              },
              spaceKey: {
                type: 'string',
                description: 'Limit search to specific space',
              },
            },
          },
        },
        {
          name: 'get_spaces',
          description: 'Get list of available Confluence spaces',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Maximum number of spaces to retrieve (default: 25)',
                default: 25,
              },
            },
          },
        },
        {
          name: 'get_page_comments',
          description: 'Get comments for a specific page',
          inputSchema: {
            type: 'object',
            properties: {
              pageId: {
                type: 'string',
                description: 'Confluence page ID',
              },
            },
            required: ['pageId'],
          },
        },
        {
          name: 'create_page',
          description: 'Create a new Confluence page',
          inputSchema: {
            type: 'object',
            properties: {
              spaceKey: {
                type: 'string',
                description: 'Space key where to create the page',
              },
              title: {
                type: 'string',
                description: 'Page title',
              },
              content: {
                type: 'string',
                description: 'Page content in HTML or Confluence storage format',
              },
              parentPageId: {
                type: 'string',
                description: 'ID of parent page (optional)',
              },
            },
            required: ['spaceKey', 'title', 'content'],
          },
        },
        {
          name: 'update_page',
          description: 'Update an existing Confluence page',
          inputSchema: {
            type: 'object',
            properties: {
              pageId: {
                type: 'string',
                description: 'ID of the page to update',
              },
              title: {
                type: 'string',
                description: 'New page title (optional)',
              },
              content: {
                type: 'string',
                description: 'New page content in HTML or Confluence storage format',
              },
            },
            required: ['pageId', 'content'],
          },
        },
        {
          name: 'create_task_page',
          description: 'Create a dedicated task/todo page with structured format',
          inputSchema: {
            type: 'object',
            properties: {
              spaceKey: {
                type: 'string',
                description: 'Space key where to create the page',
              },
              title: {
                type: 'string',
                description: 'Page title (default: "Tasks - [current date]")',
              },
              tasks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: {type: 'string'},
                    description: {type: 'string'},
                    priority: {type: 'string', enum: ['High', 'Medium', 'Low']},
                    dueDate: {type: 'string'},
                    assignee: {type: 'string'},
                    source: {type: 'string'},
                  },
                  required: ['title'],
                },
                description: 'Array of task objects',
              },
              parentPageId: {
                type: 'string',
                description: 'ID of parent page (optional)',
              },
            },
            required: ['spaceKey', 'tasks'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const {name, arguments: args} = request.params;

      try {
        logger.debug(`Handling tool request: ${name}`, { arguments: args });
        
        switch (name) {
          case 'search_pages':
            return await this.searchPages(args);
          case 'get_page_content':
            return await this.getPageContent(args);
          case 'get_recent_pages':
            return await this.getRecentPages(args);
          case 'get_my_pages':
            return await this.getMyPages(args);
          case 'get_page_tasks':
            return await this.getPageTasks(args);
          case 'get_spaces':
            return await this.getSpaces(args);
          case 'get_page_comments':
            return await this.getPageComments(args);
          case 'create_page':
            return await this.createPage(args);
          case 'update_page':
            return await this.updatePage(args);
          case 'create_task_page':
            return await this.createTaskPage(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        await logger.error(`Tool ${name} failed: ${error.message}`, {
          tool: name,
          arguments: args,
          errorStack: error.stack
        });
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
        };
      }
    });
  }

  async makeConfluenceRequest(endpoint, options = {}) {
    const url = `${this.confluenceUrl}/rest/api${endpoint}`;
    
    // Parse query parameters from endpoint for logging
    const endpointParts = endpoint.split('?');
    const endpointPath = endpointParts[0];
    const queryParams = endpointParts[1] ? Object.fromEntries(new URLSearchParams(endpointParts[1])) : {};
    
    // Log request details
    await logger.debug('Making Confluence API request', {
      baseUrl: this.confluenceUrl,
      endpoint: endpointPath,
      fullUrl: url,
      method: options.method || 'GET',
      queryParameters: queryParams
    });

    try {
      const response = await fetch(url, {
        headers: this.getAuthHeaders(),
        ...options,
      });

      // Log response details
      await logger.debug('Confluence API response received', {
        endpoint: endpointPath,
        statusCode: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries())
      });

      if (response.status === 401) {
        const responseText = await response.text();
        await logger.error('Authentication failed', {
          endpoint: endpointPath,
          responseBody: responseText.substring(0, 200)
        });
        throw new Error(`Authentication failed. Please check your CONFLUENCE_EMAIL and CONFLUENCE_API_TOKEN. Response: ${responseText.substring(0, 200)}`);
      }

      if (response.status === 404) {
        const responseText = await response.text();
        await logger.warning('Confluence API resource not found (404)', {
          endpoint: endpointPath,
          responseBody: responseText.substring(0, 500)
        });
        throw new Error(`Resource not found (404): ${responseText.substring(0, 200)}`);
      }

      if (!response.ok) {
        const responseText = await response.text();
        await logger.error('Confluence API error response', {
          endpoint: endpointPath,
          statusCode: response.status,
          statusText: response.statusText,
          responseBody: responseText.substring(0, 1000)
        });
        
        // Try to parse and extract meaningful error message
        let errorMessage = `Confluence API error: ${response.status} ${response.statusText}`;
        try {
          const errorData = JSON.parse(responseText);
          if (errorData.message) {
            errorMessage = `Confluence API error (${response.status}): ${errorData.message}`;
          }
        } catch {
          // If not JSON, include part of the response
          errorMessage += `. Response: ${responseText.substring(0, 500)}`;
        }
        
        throw new Error(errorMessage);
      }

      const responseData = await response.json();
      
      // Log successful response with truncated data
      const responseDataStr = JSON.stringify(responseData);
      const truncatedResponse = responseDataStr.length > 2000 
        ? responseDataStr.substring(0, 2000) + '... [truncated]'
        : responseDataStr;
      
      await logger.debug('Confluence API request successful', {
        endpoint: endpointPath,
        statusCode: response.status,
        responseDataSize: responseDataStr.length,
        responseData: truncatedResponse
      });

      return responseData;
    } catch (error) {
      // Log the error
      await logger.error('Confluence API request failed', {
        endpoint: endpointPath,
        url,
        errorCode: error.code,
        errorMessage: error.message,
        errorStack: error.stack
      });
      
      // Handle network errors
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        throw new Error(`Cannot connect to Confluence at ${this.confluenceUrl}. Please check the CONFLUENCE_URL configuration.`);
      }
      
      // Re-throw the error
      throw error;
    }
  }

  async searchPages(args) {
    const {query, spaceKey, limit = 25} = args;

    let cql = `title ~ "${query}" OR text ~ "${query}"`;
    if (spaceKey) {
      cql = `space = "${spaceKey}" AND (${cql})`;
    }
    
    await logger.debug('Searching Confluence pages', {
      query,
      spaceKey,
      limit,
      cql
    });

    const response = await this.makeConfluenceRequest(
        `/search?cql=${encodeURIComponent(cql)}&limit=${limit}&expand=content.space,content.history.lastUpdated,content.version`
    );

    const pages = response.results
        .filter(result => result.content.type === 'page')
        .map(result => ({
          id: result.content.id,
          title: result.content.title,
          space: result.content.space.name,
          spaceKey: result.content.space.key,
          lastUpdated: result.content.history.lastUpdated.when,
          lastUpdatedBy: result.content.history.lastUpdated.by.displayName,
          version: result.content.version.number,
          url: `${this.confluenceUrl}${result.content._links.webui}`,
          excerpt: result.excerpt || '',
        }));

    await logger.debug('Page search completed', {
      query,
      totalResults: response.totalSize,
      returnedPages: pages.length
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            query,
            total: response.totalSize,
            pages
          }, null, 2),
        },
      ],
    };
  }

  async getPageContent(args) {
    const {pageId} = args;

    await logger.debug('Fetching page content', { pageId });

    const response = await this.makeConfluenceRequest(
        `/content/${pageId}?expand=body.storage,space,history.lastUpdated,version,metadata.labels`
    );

    const page = {
      id: response.id,
      title: response.title,
      space: response.space.name,
      spaceKey: response.space.key,
      content: this.stripHtmlTags(response.body.storage.value),
      lastUpdated: response.history.lastUpdated.when,
      lastUpdatedBy: response.history.lastUpdated.by.displayName,
      version: response.version.number,
      labels: response.metadata.labels.results.map(label => label.name),
      url: `${this.confluenceUrl}${response._links.webui}`,
    };

    await logger.debug('Page content retrieved', {
      pageId,
      title: page.title,
      contentLength: page.content.length,
      labelCount: page.labels.length
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(page, null, 2),
        },
      ],
    };
  }

  async getRecentPages(args = {}) {
    const {limit = 25, spaceKey} = args;

    let cql = 'type = page';
    if (spaceKey) {
      cql = `space = "${spaceKey}" AND ${cql}`;
    }
    cql += ' ORDER BY lastmodified DESC';
    
    await logger.debug('Fetching recent pages', {
      limit,
      spaceKey,
      cql
    });

    const response = await this.makeConfluenceRequest(
        `/search?cql=${encodeURIComponent(cql)}&limit=${limit}&expand=content.space,content.history.lastUpdated,content.version`
    );

    const pages = response.results.map(result => ({
      id: result.content.id,
      title: result.content.title,
      space: result.content.space.name,
      spaceKey: result.content.space.key,
      lastUpdated: result.content.history.lastUpdated.when,
      lastUpdatedBy: result.content.history.lastUpdated.by.displayName,
      version: result.content.version.number,
      url: `${this.confluenceUrl}${result.content._links.webui}`,
    }));

    await logger.debug('Recent pages fetched', {
      totalResults: response.totalSize,
      returnedPages: pages.length
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            total: response.totalSize,
            pages
          }, null, 2),
        },
      ],
    };
  }

  async getMyPages(args = {}) {
    const {limit = 25} = args;

    await logger.debug('Fetching pages for current user', { limit });

    // Get current user info first
    const userResponse = await this.makeConfluenceRequest('/user/current');
    const currentUser = userResponse.username || userResponse.userKey;

    await logger.debug('Current user identified', { currentUser });

    const cql = `creator = "${currentUser}" AND type = page ORDER BY lastmodified DESC`;

    const response = await this.makeConfluenceRequest(
        `/search?cql=${encodeURIComponent(cql)}&limit=${limit}&expand=content.space,content.history.lastUpdated,content.version`
    );

    const pages = response.results.map(result => ({
      id: result.content.id,
      title: result.content.title,
      space: result.content.space.name,
      spaceKey: result.content.space.key,
      lastUpdated: result.content.history.lastUpdated.when,
      lastUpdatedBy: result.content.history.lastUpdated.by.displayName,
      version: result.content.version.number,
      url: `${this.confluenceUrl}${result.content._links.webui}`,
    }));

    await logger.debug('User pages fetched', {
      user: currentUser,
      totalResults: response.totalSize,
      returnedPages: pages.length
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            user: currentUser,
            total: response.totalSize,
            pages
          }, null, 2),
        },
      ],
    };
  }

  async getPageTasks(args = {}) {
    const {query = 'task OR action OR todo OR meeting', limit = 15, spaceKey} = args;

    let cql = `text ~ "${query}"`;
    if (spaceKey) {
      cql = `space = "${spaceKey}" AND ${cql}`;
    }

    await logger.debug('Searching for pages with tasks', {
      query,
      limit,
      spaceKey,
      cql
    });

    const response = await this.makeConfluenceRequest(
        `/search?cql=${encodeURIComponent(cql)}&limit=${limit}&expand=content.space,content.history.lastUpdated`
    );

    const taskPages = [];
    const pageResults = response.results.filter(r => r.content.type === 'page');
    
    await logger.debug('Found pages to analyze for tasks', {
      totalPages: pageResults.length
    });
    
    // Process pages in parallel for better performance
    const pagePromises = pageResults.map(async (result) => {
      try {
        const pageContent = await this.makeConfluenceRequest(
            `/content/${result.content.id}?expand=body.storage`
        );
        
        const content = this.stripHtmlTags(pageContent.body.storage.value);
        const extractedTasks = this.extractTasksFromContent(content);
        
        if (extractedTasks.length > 0) {
          await logger.debug('Tasks found in page', {
            pageId: result.content.id,
            pageTitle: result.content.title,
            tasksFound: extractedTasks.length
          });
          return {
            id: result.content.id,
            title: result.content.title,
            space: result.content.space.name,
            lastUpdated: result.content.history.lastUpdated.when,
            url: `${this.confluenceUrl}${result.content._links.webui}`,
            extractedTasks: extractedTasks.slice(0, ConfluenceMCPServer.MAX_TASKS_PER_PAGE), // Limit to max tasks per page
            taskCount: extractedTasks.length,
            priority: this.calculatePageTaskPriority(result.content.title, content),
          };
        }
        return null;
      } catch (error) {
        await logger.warning(`Failed to process page ${result.content.id}: ${error.message}`, {
          pageId: result.content.id,
          pageTitle: result.content.title,
          error: error.message
        });
        return null;
      }
    });
    
    const results = await Promise.allSettled(pagePromises);
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        taskPages.push(result.value);
      }
    }

    // Sort by priority
    taskPages.sort((a, b) => b.priority - a.priority);

    await logger.debug('Task extraction completed', {
      pagesSearched: response.results.length,
      pagesWithTasks: taskPages.length,
      totalTasksFound: taskPages.reduce((sum, page) => sum + page.taskCount, 0)
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            query,
            totalPagesSearched: response.results.length,
            pagesWithTasks: taskPages.length,
            pages: taskPages
          }, null, 2),
        },
      ],
    };
  }

  async getSpaces(args = {}) {
    const {limit = 25} = args;

    await logger.debug('Fetching Confluence spaces', { limit });

    const response = await this.makeConfluenceRequest(`/space?limit=${limit}&expand=description,homepage`);

    const spaces = response.results.map(space => ({
      key: space.key,
      name: space.name,
      type: space.type,
      description: space.description?.plain?.value || '',
      homepageId: space.homepage?.id
    }));

    await logger.debug('Spaces fetched', {
      totalSpaces: response.totalSize,
      returnedSpaces: spaces.length
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            total: response.totalSize,
            spaces
          }, null, 2),
        },
      ],
    };
  }

  async getPageComments(args) {
    const {pageId} = args;

    try {
      // Using v2 API for comments
      const url = `${this.confluenceUrl}/api/v2/pages/${pageId}/footer-comments`;
      
      await logger.debug('Attempting to fetch comments using v2 API', {
        pageId,
        url
      });
      
      const response = await fetch(url, {
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        await logger.debug('v2 API failed, falling back to v1 API', {
          pageId,
          v2StatusCode: response.status
        });
        
        // Fallback to v1 API if v2 fails
        const v1Response = await this.makeConfluenceRequest(
          `/content/${pageId}/child/comment?expand=history,version,body.view`
        );

        const comments = v1Response.results.map(comment => ({
          id: comment.id,
          author: comment.history.createdBy.displayName,
          authorEmail: comment.history.createdBy.email,
          createdDate: comment.history.createdDate,
          content: this.stripHtmlTags(comment.body.view.value || ''),
          version: comment.version.number,
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                pageId,
                totalComments: v1Response.size,
                comments
              }, null, 2),
            },
          ],
        };
      }

      const v2Data = await response.json();
      const comments = v2Data.results.map(comment => ({
        id: comment.id,
        author: comment.version?.createdBy?.publicName || 'Unknown',
        authorEmail: comment.version?.createdBy?.email,
        createdDate: comment.version?.createdAt,
        content: this.stripHtmlTags(comment.body?.value || ''),
        version: comment.version?.number,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              pageId,
              totalComments: comments.length,
              comments
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get page comments: ${error.message}`);
    }
  }

  async createPage(args) {
    const {spaceKey, title, content, parentPageId} = args;
    
    // Input validation
    if (!spaceKey || !title || !content) {
      throw new Error('Missing required parameters: spaceKey, title, and content are required');
    }
    
    if (title.length > 255) {
      throw new Error('Title exceeds maximum length of 255 characters');
    }
    
    if (!/^[A-Z0-9]+$/i.test(spaceKey)) {
      throw new Error('Invalid spaceKey format. Space keys should contain only alphanumeric characters');
    }

    try {
      // Check if we should use v2 API
      const useV2 = await this.checkV2ApiAvailability();
      
      await logger.debug('Creating new page', {
        spaceKey,
        title,
        hasParent: !!parentPageId,
        contentLength: content.length,
        useV2Api: useV2
      });
      
      if (useV2) {
        // Using v2 API
        const url = `${this.confluenceUrl}/api/v2/pages`;
        
        const requestBody = {
          spaceId: await this.getSpaceIdFromKey(spaceKey),
          status: 'current',
          title: title,
          body: {
            representation: 'storage',
            value: this.ensureStorageFormat(content)
          }
        };

        if (parentPageId) {
          requestBody.parentId = parentPageId;
        }

        const response = await fetch(url, {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to create page (v2): ${response.status} - ${errorText}`);
        }

        const createdPage = await response.json();
        
        await logger.debug('Page created successfully via v2 API', {
          pageId: createdPage.id,
          title: createdPage.title,
          version: createdPage.version?.number
        });
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                pageId: createdPage.id,
                title: createdPage.title,
                version: createdPage.version?.number,
                url: `${this.confluenceUrl}/wiki/spaces/${spaceKey}/pages/${createdPage.id}`,
                message: 'Page created successfully using v2 API'
              }, null, 2),
            },
          ],
        };
      } else {
        // Fallback to v1 API
        const requestBody = {
          type: 'page',
          title: title,
          space: {
            key: spaceKey
          },
          body: {
            storage: {
              value: this.ensureStorageFormat(content),
              representation: 'storage'
            }
          }
        };

        if (parentPageId) {
          requestBody.ancestors = [{id: parentPageId}];
        }

        const response = await this.makeConfluenceRequest('/content', {
          method: 'POST',
          body: JSON.stringify(requestBody)
        });

        await logger.debug('Page created successfully via v1 API', {
          pageId: response.id,
          title: response.title,
          version: response.version.number
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                pageId: response.id,
                title: response.title,
                version: response.version.number,
                url: `${this.confluenceUrl}${response._links.webui}`,
                message: 'Page created successfully using v1 API'
              }, null, 2),
            },
          ],
        };
      }
    } catch (error) {
      throw new Error(`Failed to create page: ${error.message}`);
    }
  }

  async updatePage(args) {
    const {pageId, title, content} = args;
    
    // Input validation
    if (!pageId || !content) {
      throw new Error('Missing required parameters: pageId and content are required');
    }
    
    if (title && title.length > 255) {
      throw new Error('Title exceeds maximum length of 255 characters');
    }
    
    if (!/^\d+$/.test(pageId)) {
      throw new Error('Invalid pageId format. Page ID should be numeric');
    }

    try {
      // First get the current page to get version number
      const currentPage = await this.makeConfluenceRequest(
        `/content/${pageId}?expand=version,space`
      );

      // Check if we should use v2 API
      const useV2 = await this.checkV2ApiAvailability();
      
      await logger.debug('Updating page', {
        pageId,
        currentVersion: currentPage.version.number,
        hasNewTitle: !!title,
        contentLength: content.length,
        useV2Api: useV2
      });

      if (useV2) {
        // Using v2 API
        const url = `${this.confluenceUrl}/api/v2/pages/${pageId}`;
        
        const requestBody = {
          id: pageId,
          status: 'current',
          title: title || currentPage.title,
          body: {
            representation: 'storage',
            value: this.ensureStorageFormat(content)
          },
          version: {
            number: currentPage.version.number + 1,
            message: 'Updated via MCP server'
          }
        };

        const response = await fetch(url, {
          method: 'PUT',
          headers: this.getAuthHeaders(),
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to update page (v2): ${response.status} - ${errorText}`);
        }

        const updatedPage = await response.json();
        
        await logger.debug('Page updated successfully via v2 API', {
          pageId: updatedPage.id,
          title: updatedPage.title,
          newVersion: updatedPage.version?.number
        });
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                pageId: updatedPage.id,
                title: updatedPage.title,
                version: updatedPage.version?.number,
                url: `${this.confluenceUrl}/wiki/spaces/${currentPage.space.key}/pages/${updatedPage.id}`,
                message: 'Page updated successfully using v2 API'
              }, null, 2),
            },
          ],
        };
      } else {
        // Fallback to v1 API
        const requestBody = {
          id: pageId,
          type: 'page',
          title: title || currentPage.title,
          space: {
            key: currentPage.space.key
          },
          body: {
            storage: {
              value: this.ensureStorageFormat(content),
              representation: 'storage'
            }
          },
          version: {
            number: currentPage.version.number + 1,
            message: 'Updated via MCP server'
          }
        };

        const response = await this.makeConfluenceRequest(`/content/${pageId}`, {
          method: 'PUT',
          body: JSON.stringify(requestBody)
        });

        await logger.debug('Page updated successfully via v1 API', {
          pageId: response.id,
          title: response.title,
          newVersion: response.version.number
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                pageId: response.id,
                title: response.title,
                version: response.version.number,
                url: `${this.confluenceUrl}${response._links.webui}`,
                message: 'Page updated successfully using v1 API'
              }, null, 2),
            },
          ],
        };
      }
    } catch (error) {
      throw new Error(`Failed to update page: ${error.message}`);
    }
  }

  async createTaskPage(args) {
    const {spaceKey, title, tasks, parentPageId} = args;

    try {
      // Generate page title if not provided
      const pageTitle = title || `Tasks - ${new Date().toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      })}`;

      await logger.debug('Creating task page', {
        spaceKey,
        title: pageTitle,
        taskCount: tasks.length,
        hasParent: !!parentPageId
      });

      // Build the task page content in Confluence storage format
      let content = '<h1>Task List</h1>';
      content += '<p>Generated on: ' + new Date().toLocaleString() + '</p>';
      
      // Group tasks by priority
      const tasksByPriority = {
        High: [],
        Medium: [],
        Low: [],
        undefined: []
      };

      tasks.forEach(task => {
        const priority = task.priority || 'undefined';
        tasksByPriority[priority].push(task);
      });

      // Add tasks grouped by priority
      ['High', 'Medium', 'Low', 'undefined'].forEach(priority => {
        if (tasksByPriority[priority].length > 0) {
          const displayPriority = priority === 'undefined' ? 'Unprioritized' : priority;
          content += `<h2>${displayPriority} Priority Tasks</h2>`;
          content += '<ac:task-list>';
          
          tasksByPriority[priority].forEach(task => {
            content += '<ac:task>';
            content += '<ac:task-status>incomplete</ac:task-status>';
            content += '<ac:task-body>';
            content += `<strong>${this.escapeHtml(task.title)}</strong>`;
            
            if (task.description) {
              content += `<p>${this.escapeHtml(task.description)}</p>`;
            }
            
            const metadata = [];
            if (task.dueDate) {
              metadata.push(`Due: ${task.dueDate}`);
            }
            if (task.assignee) {
              metadata.push(`Assignee: ${task.assignee}`);
            }
            if (task.source) {
              metadata.push(`Source: ${task.source}`);
            }
            
            if (metadata.length > 0) {
              const escapedMetadata = metadata.map(m => this.escapeHtml(m));
              content += `<p><em>${escapedMetadata.join(' | ')}</em></p>`;
            }
            
            content += '</ac:task-body>';
            content += '</ac:task>';
          });
          
          content += '</ac:task-list>';
        }
      });

      // Add summary table
      content += '<h2>Summary</h2>';
      content += '<table>';
      content += '<thead><tr><th>Priority</th><th>Count</th></tr></thead>';
      content += '<tbody>';
      ['High', 'Medium', 'Low', 'undefined'].forEach(priority => {
        const count = tasksByPriority[priority].length;
        if (count > 0) {
          const displayPriority = priority === 'undefined' ? 'Unprioritized' : priority;
          content += `<tr><td>${displayPriority}</td><td>${count}</td></tr>`;
        }
      });
      content += `<tr><td><strong>Total</strong></td><td><strong>${tasks.length}</strong></td></tr>`;
      content += '</tbody></table>';

      // Create the page using the existing createPage method
      return await this.createPage({
        spaceKey,
        title: pageTitle,
        content,
        parentPageId
      });
    } catch (error) {
      throw new Error(`Failed to create task page: ${error.message}`);
    }
  }

  // Helper methods
  stripHtmlTags(html) {
    if (!html) return '';
    
    // Remove Confluence-specific macros and structures
    let text = html.replace(/<ac:[^>]*>/g, '');
    text = text.replace(/<\/ac:[^>]*>/g, '');
    text = text.replace(/<ri:[^>]*>/g, '');
    text = text.replace(/<\/ri:[^>]*>/g, '');
    
    // Remove HTML tags but preserve line breaks
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/p>/gi, '\n\n');
    text = text.replace(/<\/div>/gi, '\n');
    text = text.replace(/<\/h[1-6]>/gi, '\n\n');
    text = text.replace(/<li>/gi, '\n• ');
    text = text.replace(/<\/li>/gi, '');
    
    // Remove all remaining HTML tags
    text = text.replace(/<[^>]*>/g, '');
    
    // Decode HTML entities
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    
    // Clean up excessive whitespace
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.replace(/[ \t]{2,}/g, ' ');
    
    return text.trim();
  }

  extractTasksFromContent(content) {
    const tasks = [];
    
    // Pattern for tasks/action items with various markers
    const taskPatterns = [
      /(?:^|\n)\s*[-*•]\s*\[\s*\]\s*(.+)/gm,  // Unchecked checkbox format
      /(?:^|\n)\s*[-*•]\s*TODO:?\s*(.+)/gmi,    // TODO markers
      /(?:^|\n)\s*[-*•]\s*ACTION:?\s*(.+)/gmi,  // ACTION markers
      /(?:^|\n)\s*[-*•]\s*TASK:?\s*(.+)/gmi,    // TASK markers
      /(?:^|\n)\s*\d+\.\s*TODO:?\s*(.+)/gmi,   // Numbered TODOs
      /(?:^|\n)\s*\d+\.\s*ACTION:?\s*(.+)/gmi, // Numbered ACTIONs
      /ACTION ITEM:?\s*(.+?)(?:\n|$)/gi,         // ACTION ITEM markers
      /@[\w]+\s+to\s+(.+?)(?:\n|$)/gi,          // @mention tasks
    ];

    // Look for task sections
    const sectionPatterns = [
      /(?:action items?|tasks?|todo list|next steps)[:\s]*\n([^\n]+(?:\n[^\n]+)*?)(?:\n\n|$)/gi,
      /(?:decisions?|follow[- ]?ups?)[:\s]*\n([^\n]+(?:\n[^\n]+)*?)(?:\n\n|$)/gi
    ];

    // Extract tasks using patterns
    taskPatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const taskText = match[1].trim();
        if (taskText && taskText.length > ConfluenceMCPServer.TASK_MIN_LENGTH && taskText.length < ConfluenceMCPServer.TASK_MAX_LENGTH) {
          // Filter out likely non-tasks
          if (!taskText.match(/^(the|and|or|but|if|when|where|why|how|what|who)\s/i)) {
            tasks.push({
              text: taskText,
              type: 'action_item'
            });
          }
        }
      }
    });

    // Extract from sections
    sectionPatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const sectionContent = match[1];
        const lines = sectionContent.split('\n');
        lines.forEach(line => {
          const trimmedLine = line.replace(/^\s*[-*•\d.]+\s*/, '').trim();
          if (trimmedLine && trimmedLine.length > ConfluenceMCPServer.TASK_MIN_LENGTH && trimmedLine.length < ConfluenceMCPServer.TASK_MAX_LENGTH) {
            tasks.push({
              text: trimmedLine,
              type: 'section_item'
            });
          }
        });
      }
    });

    // Remove duplicates
    const uniqueTasks = [];
    const seen = new Set();
    tasks.forEach(task => {
      const normalized = task.text.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!seen.has(normalized)) {
        seen.add(normalized);
        uniqueTasks.push(task);
      }
    });

    return uniqueTasks;
  }

  calculatePageTaskPriority(title, content) {
    let priority = 0;
    
    // Title indicators
    if (title.match(/urgent|critical|important|priority|asap/i)) {
      priority += 10;
    }
    if (title.match(/meeting|minutes|action/i)) {
      priority += 5;
    }
    if (title.match(/\d{4}-\d{2}-\d{2}|today|tomorrow|this week/i)) {
      priority += 3;
    }
    
    // Content indicators
    const urgentMatches = (content.match(/urgent|critical|asap|immediately/gi) || []).length;
    priority += urgentMatches * 2;
    
    const deadlineMatches = (content.match(/deadline|due date|by [a-z]+ \d+|before [a-z]+/gi) || []).length;
    priority += deadlineMatches * 3;
    
    const actionMatches = (content.match(/action item|todo|task|follow[- ]?up|next step/gi) || []).length;
    priority += Math.min(actionMatches, 10); // Cap at 10 to avoid inflation
    
    // Check for @mentions (usually indicates assigned tasks)
    const mentionMatches = (content.match(/@[a-zA-Z]+/g) || []).length;
    priority += mentionMatches * 2;
    
    return priority;
  }

  async checkV2ApiAvailability() {
    // Return cached result if available
    if (this._v2ApiAvailable !== null) {
      return this._v2ApiAvailable;
    }
    
    try {
      // Try a simple v2 API call to check availability
      const url = `${this.confluenceUrl}/api/v2/spaces?limit=1`;
      
      await logger.debug('Checking v2 API availability', { url });
      
      const response = await fetch(url, {
        headers: this.getAuthHeaders(),
      });
      this._v2ApiAvailable = response.ok;
      
      await logger.debug('v2 API availability check result', {
        available: this._v2ApiAvailable,
        statusCode: response.status
      });
      
      return this._v2ApiAvailable;
    } catch (error) {
      await logger.warning('v2 API availability check failed', {
        error: error.message
      });
      this._v2ApiAvailable = false;
      return false;
    }
  }

  async getSpaceIdFromKey(spaceKey) {
    try {
      // Try v2 API first
      const url = `${this.confluenceUrl}/api/v2/spaces?keys=${spaceKey}`;
      
      await logger.debug('Getting space ID from key', {
        spaceKey,
        url
      });
      
      const response = await fetch(url, {
        headers: this.getAuthHeaders(),
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.results && data.results.length > 0) {
          await logger.debug('Space ID retrieved via v2 API', {
            spaceKey,
            spaceId: data.results[0].id
          });
          return data.results[0].id;
        }
      }
      
      await logger.debug('Falling back to v1 API for space ID', {
        spaceKey,
        v2StatusCode: response.status
      });
      
      // Fallback to v1 API
      const v1Response = await this.makeConfluenceRequest(`/space/${spaceKey}`);
      
      await logger.debug('Space ID retrieved via v1 API', {
        spaceKey,
        spaceId: v1Response.id
      });
      
      return v1Response.id;
    } catch (error) {
      await logger.error(`Failed to get space ID for key ${spaceKey}`, {
        spaceKey,
        error: error.message
      });
      throw new Error(`Failed to get space ID for key ${spaceKey}: ${error.message}`);
    }
  }

  ensureStorageFormat(content) {
    // If content doesn't contain any HTML tags, wrap it in a paragraph
    if (!content.match(/<[^>]+>/)) {
      return `<p>${content}</p>`;
    }
    return content;
  }

  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    await logger.debug('Confluence MCP server started', {
      transport: 'stdio',
      logLevel: process.env.LOG_LEVEL || 'DEBUG'
    });
    console.error('Confluence MCP server running on stdio');
  }
}

// Export the class for testing
export { ConfluenceMCPServer };

// Initialize and run the server only if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new ConfluenceMCPServer();
  server.run().catch(async (error) => {
    await logger.error('Failed to start Confluence MCP server', {
      errorMessage: error.message,
      errorStack: error.stack
    });
    console.error(error);
    process.exit(1);
  });
}