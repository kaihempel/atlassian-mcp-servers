#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';

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
      console.error('Missing required environment variables: CONFLUENCE_URL, CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN');
      process.exit(1);
    }
    
    // Cache for API version availability
    this._v2ApiAvailable = null;

    this.setupToolHandlers();
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
    const response = await fetch(url, {
      headers: this.getAuthHeaders(),
      ...options,
    });

    if (!response.ok) {
      throw new Error(`Confluence API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  async searchPages(args) {
    const {query, spaceKey, limit = 25} = args;

    let cql = `title ~ "${query}" OR text ~ "${query}"`;
    if (spaceKey) {
      cql = `space = "${spaceKey}" AND (${cql})`;
    }

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

    // Get current user info first
    const userResponse = await this.makeConfluenceRequest('/user/current');
    const currentUser = userResponse.username || userResponse.userKey;

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

    const response = await this.makeConfluenceRequest(
        `/search?cql=${encodeURIComponent(cql)}&limit=${limit}&expand=content.space,content.history.lastUpdated`
    );

    const taskPages = [];
    const pageResults = response.results.filter(r => r.content.type === 'page');
    
    // Process pages in parallel for better performance
    const pagePromises = pageResults.map(async (result) => {
      try {
        const pageContent = await this.makeConfluenceRequest(
            `/content/${result.content.id}?expand=body.storage`
        );
        
        const content = this.stripHtmlTags(pageContent.body.storage.value);
        const extractedTasks = this.extractTasksFromContent(content);
        
        if (extractedTasks.length > 0) {
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
        console.warn(`Failed to process page ${result.content.id}: ${error.message}`);
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

    const response = await this.makeConfluenceRequest(`/space?limit=${limit}&expand=description,homepage`);

    const spaces = response.results.map(space => ({
      key: space.key,
      name: space.name,
      type: space.type,
      description: space.description?.plain?.value || '',
      homepageId: space.homepage?.id
    }));

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
      const response = await fetch(url, {
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
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
      const response = await fetch(url, {
        headers: this.getAuthHeaders(),
      });
      this._v2ApiAvailable = response.ok;
      return this._v2ApiAvailable;
    } catch {
      this._v2ApiAvailable = false;
      return false;
    }
  }

  async getSpaceIdFromKey(spaceKey) {
    try {
      // Try v2 API first
      const url = `${this.confluenceUrl}/api/v2/spaces?keys=${spaceKey}`;
      const response = await fetch(url, {
        headers: this.getAuthHeaders(),
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.results && data.results.length > 0) {
          return data.results[0].id;
        }
      }
      
      // Fallback to v1 API
      const v1Response = await this.makeConfluenceRequest(`/space/${spaceKey}`);
      return v1Response.id;
    } catch (error) {
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
    console.error('Confluence MCP server running on stdio');
  }
}

// Export the class for testing
export { ConfluenceMCPServer };

// Initialize and run the server only if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new ConfluenceMCPServer();
  server.run().catch(console.error);
}