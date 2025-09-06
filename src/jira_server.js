#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';
import logger from './logger.js';

export class JiraMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'jira-mcp-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Configuration from environment variables
    this.jiraUrl = process.env.JIRA_URL; // e.g., https://yourcompany.atlassian.net
    this.jiraEmail = process.env.JIRA_EMAIL;
    this.jiraApiToken = process.env.JIRA_API_TOKEN;
    this.jiraUsername = process.env.JIRA_USERNAME; // Your Atlassian account email

    if (!this.jiraUrl || !this.jiraEmail || !this.jiraApiToken) {
      logger.error('Missing required environment variables: JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN');
      console.error('Missing required environment variables: JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN');
      process.exit(1);
    }

    // Normalize the Jira URL and determine API version
    this.normalizeJiraUrl();
    
    // Enable debug logging if DEBUG environment variable is set
    this.debug = process.env.DEBUG === 'true' || process.env.DEBUG === '1';
    
    // Log initialization
    logger.debug('Initialized Jira MCP Server', {
      baseUrl: this.baseUrl,
      apiVersion: this.apiVersion,
      email: this.jiraEmail
    });

    this.setupToolHandlers();
  }

  normalizeJiraUrl() {
    // Remove trailing slash if present
    let url = this.jiraUrl.replace(/\/$/, '');
    
    // Check if the URL already includes an API path
    if (url.includes('/rest/api/')) {
      // Extract base URL and API version from the provided URL
      const match = url.match(/^(.*?)(\/rest\/api\/\d+)$/);
      if (match) {
        this.baseUrl = match[1];
        const apiPath = match[2];
        // Only support v3 now, v2 has been removed
        this.apiVersion = 3;
      } else {
        // Fallback if pattern doesn't match
        this.baseUrl = url;
        this.apiVersion = 3;
      }
    } else {
      // URL is just the base domain
      this.baseUrl = url;
      this.apiVersion = 3; // Use v3 as v2 has been removed
    }
    
    // Ensure baseUrl doesn't have trailing slash
    this.baseUrl = this.baseUrl.replace(/\/$/, '');
  }

  getAuthHeaders() {
    const auth = Buffer.from(`${this.jiraEmail}:${this.jiraApiToken}`).toString('base64');
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
          name: 'get_assigned_issues',
          description: 'Get issues assigned to the current user',
          inputSchema: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                description: 'Filter by status (e.g., "To Do", "In Progress", "Done")',
              },
              maxResults: {
                type: 'number',
                description: 'Maximum number of issues to retrieve (default: 50)',
                default: 50,
              },
            },
          },
        },
        {
          name: 'search_issues',
          description: 'Search issues using JQL (Jira Query Language)',
          inputSchema: {
            type: 'object',
            properties: {
              jql: {
                type: 'string',
                description: 'JQL query string',
              },
              maxResults: {
                type: 'number',
                description: 'Maximum number of results (default: 50)',
                default: 50,
              },
            },
            required: ['jql'],
          },
        },
        {
          name: 'get_issue_details',
          description: 'Get detailed information about a specific issue',
          inputSchema: {
            type: 'object',
            properties: {
              issueKey: {
                type: 'string',
                description: 'Jira issue key (e.g., PROJ-123)',
              },
            },
            required: ['issueKey'],
          },
        },
        {
          name: 'get_recent_issues',
          description: 'Get recently created or updated issues',
          inputSchema: {
            type: 'object',
            properties: {
              days: {
                type: 'number',
                description: 'Number of days back to search (default: 7)',
                default: 7,
              },
              maxResults: {
                type: 'number',
                description: 'Maximum number of results (default: 50)',
                default: 50,
              },
            },
          },
        },
        {
          name: 'get_my_tasks',
          description: 'Get all tasks assigned to me with priority and due date info',
          inputSchema: {
            type: 'object',
            properties: {
              includeCompleted: {
                type: 'boolean',
                description: 'Include completed tasks (default: false)',
                default: false,
              },
              maxResults: {
                type: 'number',
                description: 'Maximum number of results (default: 100)',
                default: 100,
              },
            },
          },
        },
        {
          name: 'get_project_issues',
          description: 'Get issues from a specific project',
          inputSchema: {
            type: 'object',
            properties: {
              projectKey: {
                type: 'string',
                description: 'Jira project key',
              },
              status: {
                type: 'string',
                description: 'Filter by status',
              },
              maxResults: {
                type: 'number',
                description: 'Maximum number of results (default: 50)',
                default: 50,
              },
            },
            required: ['projectKey'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'get_assigned_issues':
            return await this.getAssignedIssues(args);
          case 'search_issues':
            return await this.searchIssues(args);
          case 'get_issue_details':
            return await this.getIssueDetails(args);
          case 'get_recent_issues':
            return await this.getRecentIssues(args);
          case 'get_my_tasks':
            return await this.getMyTasks(args);
          case 'get_project_issues':
            return await this.getProjectIssues(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        await logger.error(`Tool ${name} failed: ${error.message}`, {
          tool: name,
          arguments: args,
          errorStack: error.stack,
          debugInfo: error.debugInfo
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

  async makeJiraRequest(endpoint, options = {}) {
    // Always use v3 as v2 has been removed
    const url = `${this.baseUrl}/rest/api/3${endpoint}`;
    
    // Parse query parameters from endpoint for logging
    const endpointParts = endpoint.split('?');
    const endpointPath = endpointParts[0];
    const queryParams = endpointParts[1] ? Object.fromEntries(new URLSearchParams(endpointParts[1])) : {};
    
    // Log request details
    await logger.debug('Making Jira API request', {
      baseUrl: this.baseUrl,
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
      await logger.debug('Jira API response received', {
        endpoint: endpointPath,
        statusCode: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries())
      });

      // Handle specific error cases
      if (response.status === 410) {
        // 410 Gone - API endpoint has been removed
        const responseText = await response.text();
        
        await logger.error('Jira API endpoint removed (410 Gone)', {
          endpoint: endpointPath,
          responseBody: responseText.substring(0, 500)
        });
        
        // Check if the error message mentions migration to v3
        if (responseText.includes('/rest/api/3/') || responseText.includes('api/3')) {
          throw new Error(`Jira API v2 has been removed. This server is already configured to use v3. The specific endpoint ${endpoint} might not be available. Response: ${responseText.substring(0, 500)}`);
        }
        
        throw new Error(`Jira API endpoint no longer available (410 Gone). The endpoint ${endpoint} might have been removed or renamed. Response: ${responseText.substring(0, 500)}`);
      }

      if (response.status === 401) {
        const responseText = await response.text();
        throw new Error(`Authentication failed. Please check your JIRA_EMAIL and JIRA_API_TOKEN. Response: ${responseText.substring(0, 200)}`);
      }

      if (response.status === 404) {
        const responseText = await response.text();
        
        await logger.warning('Jira API resource not found (404)', {
          endpoint: endpointPath,
          responseBody: responseText.substring(0, 500)
        });

        // Try to parse error message
        let errorMessage = `Resource not found (404)`;
        try {
          const errorData = JSON.parse(responseText);
          if (errorData.errorMessages && errorData.errorMessages.length > 0) {
            errorMessage = errorData.errorMessages.join(', ');
          } else if (errorData.message) {
            errorMessage = errorData.message;
          }
        } catch {
          // If not JSON, include part of the response
          errorMessage += `: ${responseText.substring(0, 200)}`;
        }
        
        throw new Error(errorMessage);
      }

      if (!response.ok) {
        const responseText = await response.text();
        
        await logger.error('Jira API error response', {
          endpoint: endpointPath,
          statusCode: response.status,
          statusText: response.statusText,
          responseBody: responseText.substring(0, 1000)
        });

        // Try to parse and extract meaningful error message
        let errorMessage = `Jira API error: ${response.status} ${response.statusText}`;
        try {
          const errorData = JSON.parse(responseText);
          if (errorData.errorMessages && errorData.errorMessages.length > 0) {
            errorMessage = `Jira API error (${response.status}): ${errorData.errorMessages.join(', ')}`;
          } else if (errorData.message) {
            errorMessage = `Jira API error (${response.status}): ${errorData.message}`;
          } else if (errorData.errors && Object.keys(errorData.errors).length > 0) {
            const errorDetails = Object.entries(errorData.errors)
              .map(([field, message]) => `${field}: ${message}`)
              .join(', ');
            errorMessage = `Jira API error (${response.status}): ${errorDetails}`;
          }
        } catch {
          // If not JSON, include part of the response
          errorMessage += `. Response: ${responseText.substring(0, 500)}`;
        }
        
        const error = new Error(errorMessage);
        error.debugInfo = {
          url,
          status: response.status,
          statusText: response.statusText,
          responseBody: responseText.substring(0, 1000)
        };
        throw error;
      }

      const responseData = await response.json();
      
      // Log successful response with truncated data
      const responseDataStr = JSON.stringify(responseData);
      const truncatedResponse = responseDataStr.length > 2000 
        ? responseDataStr.substring(0, 2000) + '... [truncated]'
        : responseDataStr;
      
      await logger.debug('Jira API request successful', {
        endpoint: endpointPath,
        statusCode: response.status,
        responseDataSize: responseDataStr.length,
        responseData: truncatedResponse
      });

      return responseData;
    } catch (error) {
      // Log the error
      await logger.error('Jira API request failed', {
        endpoint: endpointPath,
        url,
        errorCode: error.code,
        errorMessage: error.message,
        errorStack: error.stack
      });
      
      // Handle network errors
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        throw new Error(`Cannot connect to Jira at ${this.baseUrl}. Please check the JIRA_URL configuration.`);
      }
      
      // Re-throw the error with additional context if not already handled
      if (!error.debugInfo) {
        error.debugInfo = {
          url,
          endpoint,
          apiVersion: 3
        };
      }
      throw error;
    }
  }

  async getAssignedIssues(args = {}) {
    const { status, maxResults = 50 } = args;
    
    let jql = `assignee = currentUser() ORDER BY priority DESC, updated DESC`;
    if (status) {
      jql = `assignee = currentUser() AND status = "${status}" ORDER BY priority DESC, updated DESC`;
    }

    // Include fields parameter to get full issue details
    const fields = 'key,summary,status,priority,assignee,issuetype,project,created,updated';
    const response = await this.makeJiraRequest(`/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=${fields}`);

    const issues = (response?.issues || []).filter(issue => issue && typeof issue === 'object').map(issue => ({
      key: issue.key || issue.id || 'UNKNOWN',
      summary: issue.fields?.summary || issue.summary || 'No summary',
      status: issue.fields?.status?.name || issue.status || 'Unknown',
      priority: issue.fields?.priority?.name || issue.priority || 'None',
      assignee: issue.fields?.assignee?.displayName || issue.assignee || 'Unassigned',
      reporter: issue.fields?.reporter?.displayName || issue.reporter || 'Unknown',
      created: issue.fields?.created || issue.created,
      updated: issue.fields?.updated || issue.updated,
      duedate: issue.fields?.duedate || issue.duedate,
      issueType: issue.fields?.issuetype?.name || issue.issueType || issue.type || 'Unknown',
      project: issue.fields?.project?.name || issue.project || 'Unknown',
      url: `${this.baseUrl}/browse/${issue.key || issue.id || 'UNKNOWN'}`,
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ 
            total: response.total || issues.length, 
            isLast: response.isLast,
            nextPageToken: response.nextPageToken,
            issues 
          }, null, 2),
        },
      ],
    };
  }

  async searchIssues(args) {
    const { jql, maxResults = 50 } = args;

    // Include fields parameter to get full issue details
    const fields = 'key,summary,status,priority,assignee,issuetype,project,created,updated';
    const response = await this.makeJiraRequest(`/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=${fields}`);

    // Log response structure details
    await logger.debug('searchIssues response structure', {
      responseType: typeof response,
      hasIssuesArray: Array.isArray(response?.issues),
      numberOfIssues: response?.issues?.length || 0,
      hasTotal: 'total' in response,
      isLast: response.isLast,
      hasNextPageToken: response.nextPageToken ? true : false,
      firstIssueKey: response?.issues?.[0]?.key,
      firstIssueFields: response?.issues?.[0]?.fields ? Object.keys(response.issues[0].fields).slice(0, 5) : []
    });

    const issues = (response?.issues || []).filter(issue => issue && typeof issue === 'object').map(issue => ({
      key: issue.key || issue.id || 'UNKNOWN',
      summary: issue.fields?.summary || issue.summary || 'No summary',
      status: issue.fields?.status?.name || issue.status || 'Unknown',
      priority: issue.fields?.priority?.name || issue.priority || 'None',
      assignee: issue.fields?.assignee?.displayName || issue.assignee || 'Unassigned',
      created: issue.fields?.created || issue.created,
      updated: issue.fields?.updated || issue.updated,
      issueType: issue.fields?.issuetype?.name || issue.issueType || issue.type || 'Unknown',
      project: issue.fields?.project?.name || issue.project || 'Unknown',
      url: `${this.baseUrl}/browse/${issue.key || issue.id || 'UNKNOWN'}`,
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ 
            jql, 
            total: response.total || issues.length, 
            isLast: response.isLast,
            nextPageToken: response.nextPageToken,
            issues 
          }, null, 2),
        },
      ],
    };
  }

  async getIssueDetails(args) {
    const { issueKey } = args;

    const response = await this.makeJiraRequest(`/issue/${issueKey}`);

    // Helper function to extract text from ADF or return plain text
    const extractText = (field) => {
      if (!field) return null;
      // If it's an ADF object (has type and content properties)
      if (typeof field === 'object' && field.type === 'doc' && field.content) {
        return this.extractTextFromADF(field);
      }
      // Otherwise return as is (plain text)
      return field;
    };

    const issue = {
      key: response.key,
      summary: response.fields.summary,
      description: extractText(response.fields.description),
      status: response.fields.status.name,
      priority: response.fields.priority?.name || 'None',
      assignee: response.fields.assignee?.displayName || 'Unassigned',
      reporter: response.fields.reporter?.displayName || 'Unknown',
      created: response.fields.created,
      updated: response.fields.updated,
      duedate: response.fields.duedate,
      issueType: response.fields.issuetype.name,
      project: {
        key: response.fields.project.key,
        name: response.fields.project.name,
      },
      components: response.fields.components?.map(c => c.name) || [],
      labels: response.fields.labels || [],
      fixVersions: response.fields.fixVersions?.map(v => v.name) || [],
      url: `${this.baseUrl}/browse/${response.key}`,
      comments: response.fields.comment?.comments?.map(comment => ({
        author: comment.author.displayName,
        created: comment.created,
        body: extractText(comment.body),
      })) || [],
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(issue, null, 2),
        },
      ],
    };
  }

  async getRecentIssues(args = {}) {
    const { days = 7, maxResults = 50 } = args;

    const jql = `updated >= -${days}d ORDER BY updated DESC`;
    
    // Include fields parameter to get full issue details
    const fields = 'key,summary,status,priority,assignee,issuetype,project,created,updated';
    const response = await this.makeJiraRequest(`/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=${fields}`);

    const issues = (response?.issues || []).filter(issue => issue && typeof issue === 'object').map(issue => ({
      key: issue.key || issue.id || 'UNKNOWN',
      summary: issue.fields?.summary || issue.summary || 'No summary',
      status: issue.fields?.status?.name || issue.status || 'Unknown',
      priority: issue.fields?.priority?.name || issue.priority || 'None',
      assignee: issue.fields?.assignee?.displayName || issue.assignee || 'Unassigned',
      updated: issue.fields?.updated || issue.updated,
      project: issue.fields?.project?.name || issue.project || 'Unknown',
      url: `${this.baseUrl}/browse/${issue.key || issue.id || 'UNKNOWN'}`,
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ 
            period: `Last ${days} days`,
            total: response.total || issues.length, 
            isLast: response.isLast,
            nextPageToken: response.nextPageToken,
            issues 
          }, null, 2),
        },
      ],
    };
  }

  async getMyTasks(args = {}) {
    const { includeCompleted = false, maxResults = 100 } = args;

    let jql = `assignee = currentUser()`;
    if (!includeCompleted) {
      jql += ` AND status NOT IN ("Done", "Closed", "Resolved")`;
    }
    jql += ` ORDER BY priority DESC, duedate ASC, updated DESC`;

    // Include fields parameter to get full issue details
    const fields = 'key,summary,status,priority,duedate,project,issuetype,updated,assignee';
    const response = await this.makeJiraRequest(`/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=${fields}`);

    // Log response structure details
    await logger.debug('getMyTasks response structure', {
      responseType: typeof response,
      hasIssuesArray: Array.isArray(response?.issues),
      numberOfIssues: response?.issues?.length || 0,
      hasTotal: 'total' in response,
      isLast: response.isLast,
      hasNextPageToken: response.nextPageToken ? true : false,
      firstIssueStructure: response?.issues?.[0] ? JSON.stringify(response.issues[0], null, 2).substring(0, 500) : null,
      responseKeys: response ? Object.keys(response) : []
    });

    // Check if response has the expected structure
    if (!response || typeof response !== 'object') {
      throw new Error('Invalid response from Jira API');
    }

    // Handle case where the API returns data in a different structure
    let issuesArray = response.issues || response.values || [];
    
    // If the response itself is an array, use it directly
    if (Array.isArray(response)) {
      issuesArray = response;
    }

    // Log if we found issues
    await logger.debug('Issues array details', {
      issuesFound: issuesArray.length,
      firstIssue: issuesArray[0] ? JSON.stringify(issuesArray[0]).substring(0, 500) : null
    });

    const tasks = issuesArray.map(issue => {
      // More detailed logging for debugging
      if (!issue || typeof issue !== 'object') {
        logger.warning('Invalid issue structure in getMyTasks', {
          issueType: typeof issue,
          issueData: JSON.stringify(issue).substring(0, 200)
        });
        return null;
      }

      // Check for key in different possible locations
      const issueKey = issue.key || issue.id || issue.issueKey;
      
      if (!issueKey) {
        logger.warning('Issue missing key field', {
          availableFields: Object.keys(issue).slice(0, 10),
          issueData: JSON.stringify(issue).substring(0, 200)
        });
        return null;
      }

      const dueDate = issue.fields?.duedate || issue.duedate;
      const isOverdue = dueDate && new Date(dueDate) < new Date();
      
      return {
        key: issueKey,
        summary: issue.fields?.summary || issue.summary || 'No summary',
        status: issue.fields?.status?.name || issue.status?.name || issue.status || 'Unknown',
        priority: issue.fields?.priority?.name || issue.priority?.name || issue.priority || 'None',
        dueDate: dueDate,
        isOverdue: isOverdue,
        project: issue.fields?.project?.name || issue.project?.name || issue.project || 'Unknown',
        issueType: issue.fields?.issuetype?.name || issue.issuetype?.name || issue.issueType || issue.type || 'Unknown',
        updated: issue.fields?.updated || issue.updated,
        url: `${this.baseUrl}/browse/${issueKey}`,
        taskPriority: this.calculateTaskPriority(issue),
      };
    }).filter(task => task !== null); // Remove null entries

    // Sort by calculated task priority
    tasks.sort((a, b) => b.taskPriority - a.taskPriority);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ 
            total: response.total || response.totalCount || tasks.length,
            isLast: response.isLast !== undefined ? response.isLast : true,
            nextPageToken: response.nextPageToken || response.startAt,
            overdueTasks: tasks.filter(t => t.isOverdue).length,
            tasks 
          }, null, 2),
        },
      ],
    };
  }

  async getProjectIssues(args) {
    const { projectKey, status, maxResults = 50 } = args;

    let jql = `project = "${projectKey}"`;
    if (status) {
      jql += ` AND status = "${status}"`;
    }
    jql += ` ORDER BY priority DESC, updated DESC`;

    // Include fields parameter to get full issue details
    const fields = 'key,summary,status,priority,assignee,issuetype,project,created,updated';
    const response = await this.makeJiraRequest(`/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=${fields}`);

    const issues = (response?.issues || []).filter(issue => issue && typeof issue === 'object').map(issue => ({
      key: issue.key || issue.id || 'UNKNOWN',
      summary: issue.fields?.summary || issue.summary || 'No summary',
      status: issue.fields?.status?.name || issue.status || 'Unknown',
      priority: issue.fields?.priority?.name || issue.priority || 'None',
      assignee: issue.fields?.assignee?.displayName || issue.assignee || 'Unassigned',
      created: issue.fields?.created || issue.created,
      updated: issue.fields?.updated || issue.updated,
      issueType: issue.fields?.issuetype?.name || issue.issueType || issue.type || 'Unknown',
      url: `${this.baseUrl}/browse/${issue.key || issue.id || 'UNKNOWN'}`,
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ 
            project: projectKey,
            total: response.total || issues.length, 
            isLast: response.isLast,
            nextPageToken: response.nextPageToken,
            issues 
          }, null, 2),
        },
      ],
    };
  }

  calculateTaskPriority(issue) {
    let priority = 0;

    // Priority weight
    const priorityMap = {
      'Highest': 5,
      'High': 4,
      'Medium': 3,
      'Low': 2,
      'Lowest': 1,
    };
    priority += priorityMap[issue.fields?.priority?.name] || 2;

    // Due date weight
    if (issue.fields?.duedate) {
      const dueDate = new Date(issue.fields.duedate);
      const today = new Date();
      const daysUntilDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
      
      if (daysUntilDue < 0) priority += 10; // Overdue
      else if (daysUntilDue <= 1) priority += 8; // Due today/tomorrow
      else if (daysUntilDue <= 7) priority += 5; // Due this week
      else if (daysUntilDue <= 30) priority += 2; // Due this month
    }

    // Issue type weight
    if (issue.fields?.issuetype?.name === 'Bug') priority += 2;
    if (issue.fields?.issuetype?.name === 'Story') priority += 1;

    return priority;
  }

  // Helper method to extract plain text from Atlassian Document Format (ADF)
  extractTextFromADF(adfNode) {
    if (!adfNode) return '';
    
    let text = '';
    
    // Process content array if it exists
    if (adfNode.content && Array.isArray(adfNode.content)) {
      for (const node of adfNode.content) {
        text += this.extractTextFromADF(node);
      }
    }
    
    // Handle text nodes
    if (adfNode.type === 'text' && adfNode.text) {
      text += adfNode.text;
    }
    
    // Add appropriate separators for block-level elements
    if (['paragraph', 'heading', 'blockquote', 'listItem'].includes(adfNode.type)) {
      if (text && !text.endsWith('\n')) {
        text += '\n';
      }
    }
    
    // Handle hard breaks
    if (adfNode.type === 'hardBreak') {
      text += '\n';
    }
    
    return text;
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    await logger.debug('Jira MCP server started', {
      transport: 'stdio',
      logLevel: process.env.LOG_LEVEL || 'DEBUG'
    });
    console.error('Jira MCP server running on stdio');
  }
}

// Start the server
const server = new JiraMCPServer();
server.run().catch(async (error) => {
  await logger.error('Failed to start Jira MCP server', {
    errorMessage: error.message,
    errorStack: error.stack
  });
  console.error(error);
  process.exit(1);
});