/**
 * HTML processing utilities
 * Handles HTML stripping, escaping, and formatting for Confluence content
 */
export class HtmlProcessor {
  constructor() {
    // HTML entities map for decoding
    this.htmlEntities = {
      '&nbsp;': ' ',
      '&lt;': '<',
      '&gt;': '>',
      '&amp;': '&',
      '&quot;': '"',
      '&#39;': "'",
      '&apos;': "'",
      '&cent;': '¢',
      '&pound;': '£',
      '&yen;': '¥',
      '&euro;': '€',
      '&copy;': '©',
      '&reg;': '®',
      '&trade;': '™',
      '&times;': '×',
      '&divide;': '÷',
      '&ndash;': '–',
      '&mdash;': '—',
      '&lsquo;': ''',
      '&rsquo;': ''',
      '&ldquo;': '"',
      '&rdquo;': '"',
      '&hellip;': '…',
      '&bull;': '•',
    };
    
    // Map for escaping HTML
    this.escapeMap = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
  }
  
  /**
   * Strip HTML tags from content
   * @param {string} html - HTML content
   * @param {Object} options - Processing options
   * @returns {string} - Text without HTML
   */
  stripHtml(html, options = {}) {
    if (!html) return '';
    
    const {
      preserveLineBreaks = true,
      preserveLists = true,
      decodeEntities = true,
      removeConfluenceMacros = true,
    } = options;
    
    let text = html;
    
    // Remove Confluence-specific macros
    if (removeConfluenceMacros) {
      text = this.removeConfluenceMacros(text);
    }
    
    // Preserve line breaks
    if (preserveLineBreaks) {
      text = this.preserveLineBreaks(text);
    }
    
    // Preserve list structure
    if (preserveLists) {
      text = this.preserveLists(text);
    }
    
    // Remove all remaining HTML tags
    text = text.replace(/<[^>]*>/g, '');
    
    // Decode HTML entities
    if (decodeEntities) {
      text = this.decodeHtmlEntities(text);
    }
    
    // Clean up whitespace
    text = this.cleanWhitespace(text);
    
    return text.trim();
  }
  
  /**
   * Remove Confluence-specific macros
   * @param {string} html - HTML with Confluence macros
   * @returns {string} - HTML without macros
   */
  removeConfluenceMacros(html) {
    let text = html;
    
    // Remove Confluence structured macros
    text = text.replace(/<ac:[^>]*>/g, '');
    text = text.replace(/<\/ac:[^>]*>/g, '');
    
    // Remove rich text macros
    text = text.replace(/<ri:[^>]*>/g, '');
    text = text.replace(/<\/ri:[^>]*>/g, '');
    
    // Remove Confluence specific attributes
    text = text.replace(/\sac:[^=]*="[^"]*"/g, '');
    text = text.replace(/\sri:[^=]*="[^"]*"/g, '');
    
    return text;
  }
  
  /**
   * Preserve line breaks in HTML
   * @param {string} html - HTML content
   * @returns {string} - HTML with preserved line breaks
   */
  preserveLineBreaks(html) {
    let text = html;
    
    // Convert break tags to newlines
    text = text.replace(/<br\s*\/?>/gi, '\n');
    
    // Add double newlines after block elements
    text = text.replace(/<\/p>/gi, '\n\n');
    text = text.replace(/<\/div>/gi, '\n');
    text = text.replace(/<\/h[1-6]>/gi, '\n\n');
    text = text.replace(/<\/blockquote>/gi, '\n\n');
    text = text.replace(/<\/pre>/gi, '\n\n');
    
    // Add newlines after list items
    text = text.replace(/<\/li>/gi, '\n');
    text = text.replace(/<\/ul>/gi, '\n');
    text = text.replace(/<\/ol>/gi, '\n');
    
    return text;
  }
  
  /**
   * Preserve list structure
   * @param {string} html - HTML with lists
   * @returns {string} - HTML with preserved list markers
   */
  preserveLists(html) {
    let text = html;
    
    // Convert unordered list items to bullet points
    text = text.replace(/<li>/gi, '\n• ');
    
    // Handle ordered lists (simplified - doesn't maintain numbering)
    text = text.replace(/<ol[^>]*>/gi, '\n');
    text = text.replace(/<ul[^>]*>/gi, '\n');
    
    return text;
  }
  
  /**
   * Decode HTML entities
   * @param {string} text - Text with HTML entities
   * @returns {string} - Text with decoded entities
   */
  decodeHtmlEntities(text) {
    let decoded = text;
    
    // Decode named entities
    for (const [entity, char] of Object.entries(this.htmlEntities)) {
      decoded = decoded.replace(new RegExp(entity, 'g'), char);
    }
    
    // Decode numeric entities
    decoded = decoded.replace(/&#(\d+);/g, (match, dec) => {
      return String.fromCharCode(dec);
    });
    
    // Decode hex entities
    decoded = decoded.replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    });
    
    return decoded;
  }
  
  /**
   * Clean up excessive whitespace
   * @param {string} text - Text with whitespace
   * @returns {string} - Cleaned text
   */
  cleanWhitespace(text) {
    let cleaned = text;
    
    // Replace multiple newlines with double newline
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    
    // Replace multiple spaces with single space
    cleaned = cleaned.replace(/[ \t]{2,}/g, ' ');
    
    // Remove leading/trailing whitespace from lines
    cleaned = cleaned.split('\n').map(line => line.trim()).join('\n');
    
    return cleaned;
  }
  
  /**
   * Escape HTML special characters
   * @param {string} text - Text to escape
   * @returns {string} - Escaped text
   */
  escapeHtml(text) {
    if (!text) return '';
    
    return text.replace(/[&<>"']/g, char => this.escapeMap[char]);
  }
  
  /**
   * Ensure content is in Confluence storage format
   * @param {string} content - Content to format
   * @returns {string} - Storage formatted content
   */
  ensureStorageFormat(content) {
    if (!content) return '<p></p>';
    
    // Check if content already contains HTML tags
    if (!/<[^>]+>/.test(content)) {
      // Wrap plain text in paragraph tags
      return `<p>${this.escapeHtml(content)}</p>`;
    }
    
    return content;
  }
  
  /**
   * Convert markdown-style formatting to Confluence storage format
   * @param {string} text - Markdown-style text
   * @returns {string} - Confluence storage format
   */
  markdownToStorage(text) {
    let storage = text;
    
    // Convert headers
    storage = storage.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    storage = storage.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    storage = storage.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    
    // Convert bold
    storage = storage.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    storage = storage.replace(/__(.+?)__/g, '<strong>$1</strong>');
    
    // Convert italic
    storage = storage.replace(/\*(.+?)\*/g, '<em>$1</em>');
    storage = storage.replace(/_(.+?)_/g, '<em>$1</em>');
    
    // Convert code
    storage = storage.replace(/`(.+?)`/g, '<code>$1</code>');
    
    // Convert links
    storage = storage.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
    
    // Convert line breaks
    storage = storage.replace(/\n\n/g, '</p><p>');
    storage = storage.replace(/\n/g, '<br/>');
    
    // Wrap in paragraph if not already
    if (!storage.startsWith('<')) {
      storage = `<p>${storage}</p>`;
    }
    
    return storage;
  }
  
  /**
   * Extract text content from specific HTML elements
   * @param {string} html - HTML content
   * @param {string} selector - Element selector (simplified)
   * @returns {Array} - Extracted text content
   */
  extractFromElements(html, selector) {
    const results = [];
    const pattern = new RegExp(`<${selector}[^>]*>([^<]*)<\/${selector}>`, 'gi');
    let match;
    
    while ((match = pattern.exec(html)) !== null) {
      const text = this.stripHtml(match[1]);
      if (text) {
        results.push(text);
      }
    }
    
    return results;
  }
  
  /**
   * Create Confluence task list HTML
   * @param {Array} tasks - Array of task objects
   * @returns {string} - Confluence task list HTML
   */
  createTaskList(tasks) {
    let html = '<ac:task-list>\n';
    
    for (const task of tasks) {
      html += '  <ac:task>\n';
      html += `    <ac:task-status>${task.completed ? 'complete' : 'incomplete'}</ac:task-status>\n`;
      html += '    <ac:task-body>\n';
      html += `      <strong>${this.escapeHtml(task.title)}</strong>\n`;
      
      if (task.description) {
        html += `      <p>${this.escapeHtml(task.description)}</p>\n`;
      }
      
      if (task.metadata) {
        const metaItems = [];
        if (task.metadata.dueDate) {
          metaItems.push(`Due: ${this.escapeHtml(task.metadata.dueDate)}`);
        }
        if (task.metadata.assignee) {
          metaItems.push(`Assignee: ${this.escapeHtml(task.metadata.assignee)}`);
        }
        if (metaItems.length > 0) {
          html += `      <p><em>${metaItems.join(' | ')}</em></p>\n`;
        }
      }
      
      html += '    </ac:task-body>\n';
      html += '  </ac:task>\n';
    }
    
    html += '</ac:task-list>';
    
    return html;
  }
  
  /**
   * Create HTML table
   * @param {Array} headers - Table headers
   * @param {Array} rows - Table rows
   * @returns {string} - HTML table
   */
  createTable(headers, rows) {
    let html = '<table>\n';
    
    // Add headers
    if (headers && headers.length > 0) {
      html += '  <thead>\n    <tr>\n';
      for (const header of headers) {
        html += `      <th>${this.escapeHtml(header)}</th>\n`;
      }
      html += '    </tr>\n  </thead>\n';
    }
    
    // Add rows
    html += '  <tbody>\n';
    for (const row of rows) {
      html += '    <tr>\n';
      for (const cell of row) {
        html += `      <td>${this.escapeHtml(String(cell))}</td>\n`;
      }
      html += '    </tr>\n';
    }
    html += '  </tbody>\n';
    
    html += '</table>';
    
    return html;
  }
  
  /**
   * Sanitize HTML to prevent XSS
   * @param {string} html - HTML to sanitize
   * @param {Object} options - Sanitization options
   * @returns {string} - Sanitized HTML
   */
  sanitizeHtml(html, options = {}) {
    const {
      allowedTags = ['p', 'br', 'strong', 'em', 'u', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
      allowedAttributes = { a: ['href', 'title'] },
    } = options;
    
    // This is a simplified sanitizer - in production, use a library like DOMPurify
    let sanitized = html;
    
    // Remove script tags and content
    sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    
    // Remove event handlers
    sanitized = sanitized.replace(/\son\w+\s*=\s*"[^"]*"/gi, '');
    sanitized = sanitized.replace(/\son\w+\s*=\s*'[^']*'/gi, '');
    
    // Remove javascript: protocol
    sanitized = sanitized.replace(/javascript:/gi, '');
    
    return sanitized;
  }
}