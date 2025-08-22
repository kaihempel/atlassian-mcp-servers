#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';

class ConfluenceMCPServer {
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

    for (const result of response.results.filter(r => r.content.type === 'page')) {
      // Get full page content to extract tasks
      const pageContent = await this.makeConfluenceRequest(
          `/content/${result.content.id}?expand=body.storage`
      );

      const content = this.stripHtmlTags(pageContent.body.storage.value);
      const extractedTasks = this.extractTasksFromContent(content);

      if (extractedTasks.length > 0) {
        taskPages.push({
          id: result.content.id,
          title: result.content.title,
          space: result.content.space.name,
          lastUpdated: result.content.history.lastUpdated.when,
          url: `${this.confluenceUrl}${result.content._links.webui}`,
          extractedTasks: extractedTasks.slice(0, 5), // Limit to 5 tasks per page
          taskCount: extractedTasks.length,
          priority: this.calculatePageTaskPriority(result.content.title, content),
        });
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
}