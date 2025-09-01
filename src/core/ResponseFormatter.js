/**
 * Response formatter for MCP protocol
 * Standardizes response format for all tools
 */
export class ResponseFormatter {
  constructor(options = {}) {
    this.prettyPrint = options.prettyPrint !== false;
    this.includeMetadata = options.includeMetadata === true;
    this.maxTextLength = options.maxTextLength || 100000; // Max length for text responses
  }
  
  /**
   * Format successful response
   * @param {*} data - Response data
   * @param {Object} metadata - Optional metadata
   * @returns {Object} - Formatted MCP response
   */
  success(data, metadata = {}) {
    // Handle different data types
    if (typeof data === 'string') {
      return this.textResponse(data, metadata);
    }
    
    if (Array.isArray(data)) {
      return this.arrayResponse(data, metadata);
    }
    
    if (typeof data === 'object' && data !== null) {
      // Check if it's already an MCP formatted response
      if (data.content && Array.isArray(data.content)) {
        return data;
      }
      
      return this.objectResponse(data, metadata);
    }
    
    // For primitive types
    return this.textResponse(String(data), metadata);
  }
  
  /**
   * Format error response
   * @param {Error|Object} error - Error object
   * @returns {Object} - Formatted MCP error response
   */
  error(error) {
    const errorMessage = error.message || 'An unknown error occurred';
    const errorCode = error.code || error.status || 'ERROR';
    const errorDetails = error.details || {};
    
    const response = {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}`,
        },
      ],
    };
    
    // Add error details if available
    if (Object.keys(errorDetails).length > 0) {
      response.content.push({
        type: 'text',
        text: `\nDetails: ${this.formatJson(errorDetails)}`,
      });
    }
    
    // Add error code as metadata
    if (this.includeMetadata) {
      response.metadata = {
        errorCode,
        timestamp: new Date().toISOString(),
      };
    }
    
    return response;
  }
  
  /**
   * Format text response
   * @param {string} text - Text content
   * @param {Object} metadata - Optional metadata
   * @returns {Object} - Formatted MCP response
   */
  textResponse(text, metadata = {}) {
    // Truncate if too long
    let finalText = text;
    let truncated = false;
    
    if (text.length > this.maxTextLength) {
      finalText = text.substring(0, this.maxTextLength) + '\n... (truncated)';
      truncated = true;
    }
    
    const response = {
      content: [
        {
          type: 'text',
          text: finalText,
        },
      ],
    };
    
    if (this.includeMetadata) {
      response.metadata = {
        ...metadata,
        truncated,
        originalLength: text.length,
      };
    }
    
    return response;
  }
  
  /**
   * Format object response
   * @param {Object} obj - Object to format
   * @param {Object} metadata - Optional metadata
   * @returns {Object} - Formatted MCP response
   */
  objectResponse(obj, metadata = {}) {
    const jsonString = this.formatJson(obj);
    return this.textResponse(jsonString, metadata);
  }
  
  /**
   * Format array response
   * @param {Array} arr - Array to format
   * @param {Object} metadata - Optional metadata
   * @returns {Object} - Formatted MCP response
   */
  arrayResponse(arr, metadata = {}) {
    // For large arrays, provide summary
    if (arr.length > 100) {
      const summary = {
        totalItems: arr.length,
        firstItems: arr.slice(0, 10),
        lastItems: arr.slice(-5),
        message: `Showing first 10 and last 5 items of ${arr.length} total items`,
      };
      
      return this.objectResponse(summary, {
        ...metadata,
        summarized: true,
        originalCount: arr.length,
      });
    }
    
    return this.objectResponse(arr, metadata);
  }
  
  /**
   * Format paginated response
   * @param {Array} items - Items to paginate
   * @param {number} page - Current page
   * @param {number} pageSize - Items per page
   * @param {number} total - Total items
   * @param {Object} metadata - Optional metadata
   * @returns {Object} - Formatted MCP response
   */
  paginatedResponse(items, page, pageSize, total, metadata = {}) {
    const totalPages = Math.ceil(total / pageSize);
    
    const response = {
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
    
    return this.objectResponse(response, {
      ...metadata,
      paginated: true,
    });
  }
  
  /**
   * Format multi-part response (multiple content blocks)
   * @param {Array} parts - Array of content parts
   * @returns {Object} - Formatted MCP response
   */
  multiPartResponse(parts) {
    const content = [];
    
    for (const part of parts) {
      if (typeof part === 'string') {
        content.push({
          type: 'text',
          text: part,
        });
      } else if (part.type && part.text) {
        content.push(part);
      } else {
        content.push({
          type: 'text',
          text: this.formatJson(part),
        });
      }
    }
    
    return { content };
  }
  
  /**
   * Format progress response
   * @param {string} message - Progress message
   * @param {number} current - Current progress
   * @param {number} total - Total items
   * @param {Object} metadata - Optional metadata
   * @returns {Object} - Formatted MCP response
   */
  progressResponse(message, current, total, metadata = {}) {
    const percentage = Math.round((current / total) * 100);
    const progressBar = this.createProgressBar(percentage);
    
    const text = `${message}\n${progressBar} ${percentage}% (${current}/${total})`;
    
    return this.textResponse(text, {
      ...metadata,
      progress: {
        current,
        total,
        percentage,
      },
    });
  }
  
  /**
   * Create a text progress bar
   * @param {number} percentage - Progress percentage
   * @returns {string} - Progress bar string
   */
  createProgressBar(percentage) {
    const barLength = 20;
    const filled = Math.round(barLength * (percentage / 100));
    const empty = barLength - filled;
    
    return `[${'='.repeat(filled)}${' '.repeat(empty)}]`;
  }
  
  /**
   * Format JSON with proper indentation
   * @param {*} obj - Object to format
   * @returns {string} - Formatted JSON string
   */
  formatJson(obj) {
    if (!this.prettyPrint) {
      return JSON.stringify(obj);
    }
    
    try {
      return JSON.stringify(obj, null, 2);
    } catch (error) {
      // Handle circular references
      const seen = new WeakSet();
      return JSON.stringify(obj, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular Reference]';
          }
          seen.add(value);
        }
        return value;
      }, 2);
    }
  }
  
  /**
   * Format table response
   * @param {Array} rows - Table rows
   * @param {Array} headers - Table headers
   * @param {Object} metadata - Optional metadata
   * @returns {Object} - Formatted MCP response
   */
  tableResponse(rows, headers = null, metadata = {}) {
    if (!headers && rows.length > 0) {
      // Try to extract headers from first row if it's an object
      if (typeof rows[0] === 'object' && !Array.isArray(rows[0])) {
        headers = Object.keys(rows[0]);
      }
    }
    
    let tableText = '';
    
    // Add headers
    if (headers) {
      tableText += headers.join(' | ') + '\n';
      tableText += headers.map(() => '---').join(' | ') + '\n';
    }
    
    // Add rows
    for (const row of rows) {
      if (Array.isArray(row)) {
        tableText += row.join(' | ') + '\n';
      } else if (typeof row === 'object') {
        const values = headers ? headers.map(h => row[h] || '') : Object.values(row);
        tableText += values.join(' | ') + '\n';
      }
    }
    
    return this.textResponse(tableText, {
      ...metadata,
      format: 'table',
      rowCount: rows.length,
    });
  }
  
  /**
   * Format list response
   * @param {Array} items - List items
   * @param {boolean} numbered - Use numbered list
   * @param {Object} metadata - Optional metadata
   * @returns {Object} - Formatted MCP response
   */
  listResponse(items, numbered = false, metadata = {}) {
    let listText = '';
    
    items.forEach((item, index) => {
      const prefix = numbered ? `${index + 1}. ` : '• ';
      
      if (typeof item === 'string') {
        listText += prefix + item + '\n';
      } else {
        listText += prefix + this.formatJson(item) + '\n';
      }
    });
    
    return this.textResponse(listText, {
      ...metadata,
      format: 'list',
      itemCount: items.length,
    });
  }
}