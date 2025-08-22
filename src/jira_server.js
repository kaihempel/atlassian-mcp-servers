#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';

class JiraMCPServer {
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
      console.error('Missing required environment variables: JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN');
      process.exit(1);
    }

    this.setupToolHandlers();
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
    const url = `${this.jiraUrl}/rest/api/3${endpoint}`;
    const response = await fetch(url, {
      headers: this.getAuthHeaders(),
      ...options,
    });

    if (!response.ok) {
      throw new Error(`Jira API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  async getAssignedIssues(args = {}) {
    const { status, maxResults = 50 } = args;
    
    let jql = `assignee = currentUser() ORDER BY priority DESC, updated DESC`;
    if (status) {
      jql = `assignee = currentUser() AND status = "${status}" ORDER BY priority DESC, updated DESC`;
    }

    const response = await this.makeJiraRequest(`/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}`);

    const issues = response.issues.map(issue => ({
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status.name,
      priority: issue.fields.priority?.name || 'None',
      assignee: issue.fields.assignee?.displayName || 'Unassigned',
      reporter: issue.fields.reporter?.displayName || 'Unknown',
      created: issue.fields.created,
      updated: issue.fields.updated,
      duedate: issue.fields.duedate,
      issueType: issue.fields.issuetype.name,
      project: issue.fields.project.name,
      url: `${this.jiraUrl}/browse/${issue.key}`,
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ total: response.total, issues }, null, 2),
        },
      ],
    };
  }

  async searchIssues(args) {
    const { jql, maxResults = 50 } = args;

    const response = await this.makeJiraRequest(`/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}`);

    const issues = response.issues.map(issue => ({
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status.name,
      priority: issue.fields.priority?.name || 'None',
      assignee: issue.fields.assignee?.displayName || 'Unassigned',
      created: issue.fields.created,
      updated: issue.fields.updated,
      issueType: issue.fields.issuetype.name,
      project: issue.fields.project.name,
      url: `${this.jiraUrl}/browse/${issue.key}`,
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ jql, total: response.total, issues }, null, 2),
        },
      ],
    };
  }

  async getIssueDetails(args) {
    const { issueKey } = args;

    const response = await this.makeJiraRequest(`/issue/${issueKey}`);

    const issue = {
      key: response.key,
      summary: response.fields.summary,
      description: response.fields.description,
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
      url: `${this.jiraUrl}/browse/${response.key}`,
      comments: response.fields.comment?.comments?.map(comment => ({
        author: comment.author.displayName,
        created: comment.created,
        body: comment.body,
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
    
    const response = await this.makeJiraRequest(`/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}`);

    const issues = response.issues.map(issue => ({
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status.name,
      priority: issue.fields.priority?.name || 'None',
      assignee: issue.fields.assignee?.displayName || 'Unassigned',
      updated: issue.fields.updated,
      project: issue.fields.project.name,
      url: `${this.jiraUrl}/browse/${issue.key}`,
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ 
            period: `Last ${days} days`,
            total: response.total, 
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

    const response = await this.makeJiraRequest(`/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}`);

    const tasks = response.issues.map(issue => {
      const dueDate = issue.fields.duedate;
      const isOverdue = dueDate && new Date(dueDate) < new Date();
      
      return {
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        priority: issue.fields.priority?.name || 'None',
        dueDate: dueDate,
        isOverdue: isOverdue,
        project: issue.fields.project.name,
        issueType: issue.fields.issuetype.name,
        updated: issue.fields.updated,
        url: `${this.jiraUrl}/browse/${issue.key}`,
        taskPriority: this.calculateTaskPriority(issue),
      };
    });

    // Sort by calculated task priority
    tasks.sort((a, b) => b.taskPriority - a.taskPriority);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ 
            total: response.total,
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

    const response = await this.makeJiraRequest(`/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}`);

    const issues = response.issues.map(issue => ({
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status.name,
      priority: issue.fields.priority?.name || 'None',
      assignee: issue.fields.assignee?.displayName || 'Unassigned',
      created: issue.fields.created,
      updated: issue.fields.updated,
      issueType: issue.fields.issuetype.name,
      url: `${this.jiraUrl}/browse/${issue.key}`,
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ 
            project: projectKey,
            total: response.total, 
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
    priority += priorityMap[issue.fields.priority?.name] || 2;

    // Due date weight
    if (issue.fields.duedate) {
      const dueDate = new Date(issue.fields.duedate);
      const today = new Date();
      const daysUntilDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
      
      if (daysUntilDue < 0) priority += 10; // Overdue
      else if (daysUntilDue <= 1) priority += 8; // Due today/tomorrow
      else if (daysUntilDue <= 7) priority += 5; // Due this week
      else if (daysUntilDue <= 30) priority += 2; // Due this month
    }

    // Issue type weight
    if (issue.fields.issuetype.name === 'Bug') priority += 2;
    if (issue.fields.issuetype.name === 'Story') priority += 1;

    return priority;
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Jira MCP server running on stdio');
  }
}

// Start the server
const server = new JiraMCPServer();
server.run().catch(console.error);