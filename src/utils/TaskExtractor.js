/**
 * Task extraction utility
 * Extracts tasks and action items from text content
 */
export class TaskExtractor {
  constructor(config = {}) {
    this.minLength = config.minLength || 3;
    this.maxLength = config.maxLength || 500;
    this.patterns = this.initializePatterns();
    this.sectionPatterns = this.initializeSectionPatterns();
    this.excludePatterns = this.initializeExcludePatterns();
  }
  
  /**
   * Initialize task extraction patterns
   * @returns {Array} - Array of regex patterns
   */
  initializePatterns() {
    return [
      // Checkbox formats
      { pattern: /(?:^|\n)\s*[-*•]\s*\[\s*\]\s*(.+)/gm, type: 'checkbox', priority: 10 },
      { pattern: /(?:^|\n)\s*[-*•]\s*\[x\]\s*(.+)/gmi, type: 'checkbox_done', priority: 9 },
      
      // TODO markers
      { pattern: /(?:^|\n)\s*[-*•]\s*TODO:?\s*(.+)/gmi, type: 'todo', priority: 8 },
      { pattern: /(?:^|\n)\s*\d+\.\s*TODO:?\s*(.+)/gmi, type: 'todo_numbered', priority: 8 },
      { pattern: /TODO:\s*(.+?)(?:\n|$)/gi, type: 'todo_inline', priority: 7 },
      
      // ACTION markers
      { pattern: /(?:^|\n)\s*[-*•]\s*ACTION:?\s*(.+)/gmi, type: 'action', priority: 9 },
      { pattern: /(?:^|\n)\s*\d+\.\s*ACTION:?\s*(.+)/gmi, type: 'action_numbered', priority: 9 },
      { pattern: /ACTION ITEM:?\s*(.+?)(?:\n|$)/gi, type: 'action_item', priority: 9 },
      { pattern: /ACTION REQUIRED:?\s*(.+?)(?:\n|$)/gi, type: 'action_required', priority: 10 },
      
      // TASK markers
      { pattern: /(?:^|\n)\s*[-*•]\s*TASK:?\s*(.+)/gmi, type: 'task', priority: 8 },
      { pattern: /(?:^|\n)\s*\d+\.\s*TASK:?\s*(.+)/gmi, type: 'task_numbered', priority: 8 },
      
      // @mention tasks
      { pattern: /@([\w]+)\s+(?:to|please|should|must|will|can you)\s+(.+?)(?:\n|$)/gi, type: 'mention_task', priority: 7 },
      { pattern: /@([\w]+):\s*(.+?)(?:\n|$)/gi, type: 'mention_assignment', priority: 7 },
      
      // Decision/Follow-up items
      { pattern: /DECISION:?\s*(.+?)(?:\n|$)/gi, type: 'decision', priority: 6 },
      { pattern: /FOLLOW[- ]?UP:?\s*(.+?)(?:\n|$)/gi, type: 'followup', priority: 7 },
      { pattern: /NEXT STEPS?:?\s*(.+?)(?:\n|$)/gi, type: 'next_step', priority: 7 },
      
      // Deadline/Due date markers
      { pattern: /DUE:?\s*(.+?)(?:\n|$)/gi, type: 'due_item', priority: 8 },
      { pattern: /DEADLINE:?\s*(.+?)(?:\n|$)/gi, type: 'deadline_item', priority: 9 },
      
      // Issue/Bug markers
      { pattern: /ISSUE:?\s*(.+?)(?:\n|$)/gi, type: 'issue', priority: 6 },
      { pattern: /BUG:?\s*(.+?)(?:\n|$)/gi, type: 'bug', priority: 7 },
      { pattern: /FIX:?\s*(.+?)(?:\n|$)/gi, type: 'fix', priority: 7 },
    ];
  }
  
  /**
   * Initialize section patterns for extracting task sections
   * @returns {Array} - Array of section patterns
   */
  initializeSectionPatterns() {
    return [
      {
        pattern: /(?:action items?|tasks?|todo list?|to-?do list?)[:\s]*\n([^\n]+(?:\n[^\n]+)*?)(?:\n\n|$)/gi,
        type: 'task_section',
        priority: 10
      },
      {
        pattern: /(?:next steps?|follow[- ]?ups?)[:\s]*\n([^\n]+(?:\n[^\n]+)*?)(?:\n\n|$)/gi,
        type: 'next_steps_section',
        priority: 9
      },
      {
        pattern: /(?:decisions?|action required)[:\s]*\n([^\n]+(?:\n[^\n]+)*?)(?:\n\n|$)/gi,
        type: 'decision_section',
        priority: 8
      },
      {
        pattern: /(?:assignments?|responsibilities)[:\s]*\n([^\n]+(?:\n[^\n]+)*?)(?:\n\n|$)/gi,
        type: 'assignment_section',
        priority: 8
      },
    ];
  }
  
  /**
   * Initialize exclude patterns to filter out non-tasks
   * @returns {Array} - Array of exclude patterns
   */
  initializeExcludePatterns() {
    return [
      /^(the|and|or|but|if|when|where|why|how|what|who|this|that|these|those)\s/i,
      /^(is|are|was|were|been|being|be|have|has|had|do|does|did)\s/i,
      /^(in|on|at|to|for|of|with|by|from|as|into|through)\s/i,
      /^\d+$/,
      /^[a-z]$/i,
      /^(yes|no|maybe|ok|okay|sure|thanks|thank you)$/i,
    ];
  }
  
  /**
   * Extract tasks from content
   * @param {string} content - Text content
   * @param {Object} options - Extraction options
   * @returns {Array} - Extracted tasks
   */
  extract(content, options = {}) {
    if (!content) return [];
    
    const {
      includeDone = false,
      deduplicat = true,
      sortByPriority = true,
      limit = null,
    } = options;
    
    const tasks = [];
    
    // Extract using patterns
    for (const { pattern, type, priority } of this.patterns) {
      if (!includeDone && type === 'checkbox_done') {
        continue;
      }
      
      let match;
      const regex = new RegExp(pattern);
      
      while ((match = regex.exec(content)) !== null) {
        const text = this.extractTaskText(match);
        
        if (this.isValidTask(text)) {
          tasks.push({
            text: text.trim(),
            type,
            priority,
            position: match.index,
            raw: match[0],
            metadata: this.extractMetadata(text),
          });
        }
      }
    }
    
    // Extract from sections
    const sectionTasks = this.extractFromSections(content);
    tasks.push(...sectionTasks);
    
    // Process tasks
    let processed = tasks;
    
    if (deduplicat) {
      processed = this.deduplicateTasks(processed);
    }
    
    if (sortByPriority) {
      processed = this.sortByPriority(processed);
    }
    
    if (limit && limit > 0) {
      processed = processed.slice(0, limit);
    }
    
    return processed;
  }
  
  /**
   * Extract task text from regex match
   * @param {Array} match - Regex match result
   * @returns {string} - Extracted text
   */
  extractTaskText(match) {
    // Handle @mention tasks specially
    if (match.length > 2 && match[1] && match[2]) {
      // This is a mention task with assignee
      return match[2];
    }
    
    // Standard task extraction
    return match[1] || match[0];
  }
  
  /**
   * Check if extracted text is a valid task
   * @param {string} text - Task text
   * @returns {boolean} - True if valid
   */
  isValidTask(text) {
    if (!text) return false;
    
    const trimmed = text.trim();
    
    // Check length constraints
    if (trimmed.length < this.minLength || trimmed.length > this.maxLength) {
      return false;
    }
    
    // Check against exclude patterns
    for (const pattern of this.excludePatterns) {
      if (pattern.test(trimmed)) {
        return false;
      }
    }
    
    // Check for minimum word count
    const words = trimmed.split(/\s+/);
    if (words.length < 2) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Extract tasks from marked sections
   * @param {string} content - Text content
   * @returns {Array} - Extracted tasks
   */
  extractFromSections(content) {
    const tasks = [];
    
    for (const { pattern, type, priority } of this.sectionPatterns) {
      let match;
      const regex = new RegExp(pattern);
      
      while ((match = regex.exec(content)) !== null) {
        const sectionContent = match[1];
        const lines = sectionContent.split('\n');
        
        for (const line of lines) {
          // Remove list markers
          const text = line.replace(/^\s*[-*•\d.]+\s*/, '').trim();
          
          if (this.isValidTask(text)) {
            tasks.push({
              text,
              type,
              priority,
              position: match.index,
              raw: line,
              metadata: this.extractMetadata(text),
            });
          }
        }
      }
    }
    
    return tasks;
  }
  
  /**
   * Extract metadata from task text
   * @param {string} text - Task text
   * @returns {Object} - Extracted metadata
   */
  extractMetadata(text) {
    const metadata = {};
    
    // Extract @mentions
    const mentions = text.match(/@[\w]+/g);
    if (mentions) {
      metadata.assignees = mentions.map(m => m.substring(1));
    }
    
    // Extract dates
    const datePatterns = [
      /\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/,
      /\b(\d{4}-\d{2}-\d{2})\b/,
      /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:,?\s+\d{4})?\b/i,
      /\b(today|tomorrow|next\s+week|next\s+month)\b/i,
    ];
    
    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match) {
        metadata.dueDate = match[1];
        break;
      }
    }
    
    // Extract priority indicators
    const priorityMatch = text.match(/\b(urgent|high\s+priority|critical|asap|important)\b/i);
    if (priorityMatch) {
      metadata.priority = 'high';
    } else if (text.match(/\b(low\s+priority|when\s+possible|eventually)\b/i)) {
      metadata.priority = 'low';
    } else {
      metadata.priority = 'medium';
    }
    
    // Extract project/epic references
    const projectMatch = text.match(/\b([A-Z]{2,}-\d+)\b/);
    if (projectMatch) {
      metadata.issueKey = projectMatch[1];
    }
    
    // Extract tags
    const tags = text.match(/#[\w]+/g);
    if (tags) {
      metadata.tags = tags.map(t => t.substring(1));
    }
    
    return metadata;
  }
  
  /**
   * Deduplicate tasks based on normalized text
   * @param {Array} tasks - Tasks to deduplicate
   * @returns {Array} - Deduplicated tasks
   */
  deduplicateTasks(tasks) {
    const seen = new Map();
    const unique = [];
    
    for (const task of tasks) {
      const normalized = this.normalizeText(task.text);
      
      if (!seen.has(normalized)) {
        seen.set(normalized, task);
        unique.push(task);
      } else {
        // Keep the one with higher priority
        const existing = seen.get(normalized);
        if (task.priority > existing.priority) {
          const index = unique.indexOf(existing);
          unique[index] = task;
          seen.set(normalized, task);
        }
      }
    }
    
    return unique;
  }
  
  /**
   * Normalize text for comparison
   * @param {string} text - Text to normalize
   * @returns {string} - Normalized text
   */
  normalizeText(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }
  
  /**
   * Sort tasks by priority
   * @param {Array} tasks - Tasks to sort
   * @returns {Array} - Sorted tasks
   */
  sortByPriority(tasks) {
    return tasks.sort((a, b) => {
      // First sort by priority score
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      
      // Then by metadata priority
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      const aPriority = priorityOrder[a.metadata?.priority] || 0;
      const bPriority = priorityOrder[b.metadata?.priority] || 0;
      
      if (bPriority !== aPriority) {
        return bPriority - aPriority;
      }
      
      // Finally by position in document
      return a.position - b.position;
    });
  }
  
  /**
   * Group tasks by type
   * @param {Array} tasks - Tasks to group
   * @returns {Object} - Grouped tasks
   */
  groupByType(tasks) {
    const grouped = {};
    
    for (const task of tasks) {
      if (!grouped[task.type]) {
        grouped[task.type] = [];
      }
      grouped[task.type].push(task);
    }
    
    return grouped;
  }
  
  /**
   * Group tasks by assignee
   * @param {Array} tasks - Tasks to group
   * @returns {Object} - Grouped tasks
   */
  groupByAssignee(tasks) {
    const grouped = { unassigned: [] };
    
    for (const task of tasks) {
      if (task.metadata?.assignees && task.metadata.assignees.length > 0) {
        for (const assignee of task.metadata.assignees) {
          if (!grouped[assignee]) {
            grouped[assignee] = [];
          }
          grouped[assignee].push(task);
        }
      } else {
        grouped.unassigned.push(task);
      }
    }
    
    return grouped;
  }
  
  /**
   * Format tasks for display
   * @param {Array} tasks - Tasks to format
   * @param {string} format - Output format
   * @returns {string} - Formatted tasks
   */
  format(tasks, format = 'list') {
    switch (format) {
      case 'list':
        return this.formatAsList(tasks);
      case 'markdown':
        return this.formatAsMarkdown(tasks);
      case 'json':
        return JSON.stringify(tasks, null, 2);
      default:
        return this.formatAsList(tasks);
    }
  }
  
  /**
   * Format tasks as a list
   * @param {Array} tasks - Tasks to format
   * @returns {string} - Formatted list
   */
  formatAsList(tasks) {
    return tasks
      .map((task, index) => `${index + 1}. ${task.text}`)
      .join('\n');
  }
  
  /**
   * Format tasks as markdown
   * @param {Array} tasks - Tasks to format
   * @returns {string} - Markdown formatted tasks
   */
  formatAsMarkdown(tasks) {
    let markdown = '## Tasks\n\n';
    
    const grouped = this.groupByType(tasks);
    
    for (const [type, typeTasks] of Object.entries(grouped)) {
      markdown += `### ${this.formatTypeLabel(type)}\n\n`;
      
      for (const task of typeTasks) {
        markdown += `- [ ] ${task.text}`;
        
        if (task.metadata?.assignees) {
          markdown += ` (@${task.metadata.assignees.join(', @')})`;
        }
        
        if (task.metadata?.dueDate) {
          markdown += ` - Due: ${task.metadata.dueDate}`;
        }
        
        markdown += '\n';
      }
      
      markdown += '\n';
    }
    
    return markdown;
  }
  
  /**
   * Format type label for display
   * @param {string} type - Task type
   * @returns {string} - Formatted label
   */
  formatTypeLabel(type) {
    const labels = {
      checkbox: 'Checkboxes',
      checkbox_done: 'Completed',
      todo: 'TODOs',
      todo_numbered: 'TODOs',
      todo_inline: 'TODOs',
      action: 'Action Items',
      action_numbered: 'Action Items',
      action_item: 'Action Items',
      action_required: 'Actions Required',
      task: 'Tasks',
      task_numbered: 'Tasks',
      mention_task: 'Assigned Tasks',
      mention_assignment: 'Assignments',
      decision: 'Decisions',
      followup: 'Follow-ups',
      next_step: 'Next Steps',
      due_item: 'Due Items',
      deadline_item: 'Deadlines',
      issue: 'Issues',
      bug: 'Bugs',
      fix: 'Fixes',
      task_section: 'Task Section',
      next_steps_section: 'Next Steps',
      decision_section: 'Decisions',
      assignment_section: 'Assignments',
    };
    
    return labels[type] || type;
  }
}