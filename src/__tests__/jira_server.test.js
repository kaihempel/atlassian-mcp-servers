import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest';
import fetch from 'node-fetch';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Mock the modules before importing the server
vi.mock('node-fetch');
vi.mock('@modelcontextprotocol/sdk/server/index.js');
vi.mock('@modelcontextprotocol/sdk/server/stdio.js');

// Helper to create a test server instance with custom environment
async function createTestServer(env = {}) {
  // Save current env
  const savedEnv = { ...process.env };
  
  // Set test environment variables
  Object.assign(process.env, {
    JIRA_URL: env.JIRA_URL || 'https://test.atlassian.net',
    JIRA_EMAIL: env.JIRA_EMAIL || 'test@example.com',
    JIRA_API_TOKEN: env.JIRA_API_TOKEN || 'test-token-123',
    JIRA_USERNAME: env.JIRA_USERNAME || 'test@example.com',
    ...env
  });

  // Import dynamically to use the updated environment
  const { JiraMCPServer } = await import('../jira_server.js');
  
  // Create a test instance
  const server = new JiraMCPServer();
  
  // Restore env
  process.env = savedEnv;
  
  return server;
}

describe('JiraMCPServer', () => {
  let server;
  let mockFetch;
  let mockServerInstance;
  let savedEnv;

  beforeAll(() => {
    // Save the original environment
    savedEnv = { ...process.env };
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Set environment variables before importing
    process.env.JIRA_URL = 'https://test.atlassian.net';
    process.env.JIRA_EMAIL = 'test@example.com';
    process.env.JIRA_API_TOKEN = 'test-token-123';
    process.env.JIRA_USERNAME = 'test@example.com';
    
    // Mock the Server constructor
    mockServerInstance = {
      setRequestHandler: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined)
    };
    Server.mockImplementation(() => mockServerInstance);
    
    // Mock StdioServerTransport
    StdioServerTransport.mockImplementation(() => ({}));
    
    // Create test server
    server = await createTestServer();
    mockFetch = fetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Restore the original environment
    process.env = savedEnv;
  });

  describe('Constructor and Initialization', () => {
    it('should initialize with required environment variables', () => {
      expect(server.jiraUrl).toBe('https://test.atlassian.net');
      expect(server.jiraEmail).toBe('test@example.com');
      expect(server.jiraApiToken).toBe('test-token-123');
    });

    it('should exit if required environment variables are missing', async () => {
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('Process exited');
      });
      const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // Clear required env vars
      delete process.env.JIRA_URL;
      delete process.env.JIRA_EMAIL;
      delete process.env.JIRA_API_TOKEN;
      
      // This will trigger process.exit by creating a new server with missing env vars
      await expect(async () => {
        await createTestServer({
          JIRA_URL: undefined,
          JIRA_EMAIL: undefined,
          JIRA_API_TOKEN: undefined
        });
      }).rejects.toThrow('Process exited');
      
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Missing required environment variables: JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN'
      );
      expect(mockExit).toHaveBeenCalledWith(1);
      
      mockExit.mockRestore();
      mockConsoleError.mockRestore();
    });

    it('should setup tool handlers on initialization', () => {
      expect(mockServerInstance.setRequestHandler).toHaveBeenCalled();
    });
  });

  describe('getAuthHeaders', () => {
    it('should return correct authorization headers', () => {
      const headers = server.getAuthHeaders();
      const expectedAuth = Buffer.from('test@example.com:test-token-123').toString('base64');
      
      expect(headers).toEqual({
        'Authorization': `Basic ${expectedAuth}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      });
    });
  });

  describe('makeJiraRequest', () => {
    it('should make request with correct URL and headers', async () => {
      const mockResponse = { issues: [] };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse)
      });

      const result = await server.makeJiraRequest('/search/jql');
      
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.atlassian.net/rest/api/3/search/jql',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': expect.stringContaining('Basic')
          })
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('should throw error on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: vi.fn().mockResolvedValue('Unauthorized: Invalid credentials')
      });

      await expect(server.makeJiraRequest('/search/jql'))
        .rejects.toThrow('Authentication failed');
    });
  });

  describe('getAssignedIssues', () => {
    const mockIssuesResponse = {
      total: 2,
      issues: [
        {
          key: 'PROJ-123',
          fields: {
            summary: 'Test Issue 1',
            status: { name: 'In Progress' },
            priority: { name: 'High' },
            assignee: { displayName: 'John Doe' },
            reporter: { displayName: 'Jane Smith' },
            created: '2024-01-01T00:00:00Z',
            updated: '2024-01-02T00:00:00Z',
            duedate: '2024-01-15',
            issuetype: { name: 'Bug' },
            project: { name: 'Test Project' }
          }
        },
        {
          key: 'PROJ-124',
          fields: {
            summary: 'Test Issue 2',
            status: { name: 'To Do' },
            priority: null,
            assignee: null,
            reporter: null,
            created: '2024-01-03T00:00:00Z',
            updated: '2024-01-04T00:00:00Z',
            duedate: null,
            issuetype: { name: 'Task' },
            project: { name: 'Test Project' }
          }
        }
      ]
    };

    it('should fetch assigned issues without status filter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockIssuesResponse)
      });

      const result = await server.getAssignedIssues({});
      const content = JSON.parse(result.content[0].text);

      expect(content.total).toBe(2);
      expect(content.issues).toHaveLength(2);
      expect(content.issues[0].key).toBe('PROJ-123');
      expect(content.issues[0].status).toBe('In Progress');
      expect(content.issues[0].priority).toBe('High');
      expect(content.issues[0].assignee).toBe('John Doe');
      expect(content.issues[1].priority).toBe('None');
      expect(content.issues[1].assignee).toBe('Unassigned');
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('assignee%20%3D%20currentUser()'),
        expect.any(Object)
      );
    });

    it('should fetch assigned issues with status filter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockIssuesResponse)
      });

      const result = await server.getAssignedIssues({ status: 'In Progress', maxResults: 10 });
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('status%20%3D%20%22In%20Progress%22'),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('maxResults=10'),
        expect.any(Object)
      );
    });

    it('should handle maxResults parameter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockIssuesResponse)
      });

      await server.getAssignedIssues({ maxResults: 25 });
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('maxResults=25'),
        expect.any(Object)
      );
    });

    it('should include issue URL in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockIssuesResponse)
      });

      const result = await server.getAssignedIssues({});
      const content = JSON.parse(result.content[0].text);
      
      expect(content.issues[0].url).toBe('https://test.atlassian.net/browse/PROJ-123');
      expect(content.issues[1].url).toBe('https://test.atlassian.net/browse/PROJ-124');
    });
  });

  describe('searchIssues', () => {
    const mockSearchResponse = {
      total: 5,
      issues: [
        {
          key: 'PROJ-100',
          fields: {
            summary: 'Search Result 1',
            status: { name: 'Done' },
            priority: { name: 'Low' },
            assignee: { displayName: 'User 1' },
            created: '2024-01-01T00:00:00Z',
            updated: '2024-01-05T00:00:00Z',
            issuetype: { name: 'Story' },
            project: { name: 'Project A' }
          }
        }
      ]
    };

    it('should search issues with JQL query', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockSearchResponse)
      });

      const jql = 'project = "PROJ" AND status = "Done"';
      const result = await server.searchIssues({ jql });
      const content = JSON.parse(result.content[0].text);

      expect(content.jql).toBe(jql);
      expect(content.total).toBe(5);
      expect(content.issues).toHaveLength(1);
      expect(content.issues[0].key).toBe('PROJ-100');
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent(jql)),
        expect.any(Object)
      );
    });

    it('should handle complex JQL queries with special characters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockSearchResponse)
      });

      const complexJql = 'text ~ "search term" AND labels IN (bug, "high-priority")';
      await server.searchIssues({ jql: complexJql, maxResults: 100 });
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent(complexJql)),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('maxResults=100'),
        expect.any(Object)
      );
    });

    it('should include URL in search results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockSearchResponse)
      });

      const result = await server.searchIssues({ jql: 'test' });
      const content = JSON.parse(result.content[0].text);
      
      expect(content.issues[0].url).toBe('https://test.atlassian.net/browse/PROJ-100');
    });
  });

  describe('getIssueDetails', () => {
    const mockIssueDetails = {
      key: 'PROJ-999',
      fields: {
        summary: 'Detailed Issue',
        description: 'This is a detailed description of the issue',
        status: { name: 'In Review' },
        priority: { name: 'Critical' },
        assignee: { displayName: 'Assignee Name' },
        reporter: { displayName: 'Reporter Name' },
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-10T00:00:00Z',
        duedate: '2024-02-01',
        issuetype: { name: 'Epic' },
        project: {
          key: 'PROJ',
          name: 'Project Name'
        },
        components: [{ name: 'Backend' }, { name: 'Frontend' }],
        labels: ['urgent', 'customer-reported'],
        fixVersions: [{ name: 'v1.0' }, { name: 'v1.1' }],
        comment: {
          comments: [
            {
              author: { displayName: 'Commenter 1' },
              created: '2024-01-05T00:00:00Z',
              body: 'First comment'
            },
            {
              author: { displayName: 'Commenter 2' },
              created: '2024-01-06T00:00:00Z',
              body: 'Second comment'
            }
          ]
        }
      }
    };

    it('should fetch detailed issue information', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockIssueDetails)
      });

      const result = await server.getIssueDetails({ issueKey: 'PROJ-999' });
      const content = JSON.parse(result.content[0].text);

      expect(content.key).toBe('PROJ-999');
      expect(content.summary).toBe('Detailed Issue');
      expect(content.description).toBe('This is a detailed description of the issue');
      expect(content.status).toBe('In Review');
      expect(content.priority).toBe('Critical');
      expect(content.project.key).toBe('PROJ');
      expect(content.project.name).toBe('Project Name');
      expect(content.components).toEqual(['Backend', 'Frontend']);
      expect(content.labels).toEqual(['urgent', 'customer-reported']);
      expect(content.fixVersions).toEqual(['v1.0', 'v1.1']);
      expect(content.url).toBe('https://test.atlassian.net/browse/PROJ-999');
      
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.atlassian.net/rest/api/3/issue/PROJ-999',
        expect.any(Object)
      );
    });

    it('should handle comments in issue details', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockIssueDetails)
      });

      const result = await server.getIssueDetails({ issueKey: 'PROJ-999' });
      const content = JSON.parse(result.content[0].text);

      expect(content.comments).toHaveLength(2);
      expect(content.comments[0].author).toBe('Commenter 1');
      expect(content.comments[0].body).toBe('First comment');
      expect(content.comments[1].author).toBe('Commenter 2');
      expect(content.comments[1].body).toBe('Second comment');
    });

    it('should handle ADF content in description and comments', async () => {
      const issueWithADF = {
        key: 'PROJ-ADF',
        fields: {
          summary: 'Issue with ADF content',
          description: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'This is an ADF description.'
                  }
                ]
              }
            ]
          },
          status: { name: 'Open' },
          priority: { name: 'High' },
          assignee: { displayName: 'User' },
          reporter: { displayName: 'Reporter' },
          created: '2024-01-01T00:00:00Z',
          updated: '2024-01-01T00:00:00Z',
          duedate: null,
          issuetype: { name: 'Task' },
          project: { key: 'PROJ', name: 'Project' },
          comment: {
            comments: [
              {
                author: { displayName: 'Commenter' },
                created: '2024-01-02T00:00:00Z',
                body: {
                  type: 'doc',
                  content: [
                    {
                      type: 'paragraph',
                      content: [
                        {
                          type: 'text',
                          text: 'ADF comment text.'
                        }
                      ]
                    }
                  ]
                }
              },
              {
                author: { displayName: 'Another User' },
                created: '2024-01-03T00:00:00Z',
                body: 'Plain text comment'
              }
            ]
          }
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(issueWithADF)
      });

      const result = await server.getIssueDetails({ issueKey: 'PROJ-ADF' });
      const content = JSON.parse(result.content[0].text);

      expect(content.description).toBe('This is an ADF description.\n');
      expect(content.comments[0].body).toBe('ADF comment text.\n');
      expect(content.comments[1].body).toBe('Plain text comment');
    });

    it('should handle missing optional fields', async () => {
      const minimalIssue = {
        key: 'PROJ-001',
        fields: {
          summary: 'Minimal Issue',
          description: null,
          status: { name: 'Open' },
          priority: null,
          assignee: null,
          reporter: null,
          created: '2024-01-01T00:00:00Z',
          updated: '2024-01-01T00:00:00Z',
          duedate: null,
          issuetype: { name: 'Task' },
          project: { key: 'PROJ', name: 'Project' },
          components: null,
          labels: null,
          fixVersions: null,
          comment: null
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(minimalIssue)
      });

      const result = await server.getIssueDetails({ issueKey: 'PROJ-001' });
      const content = JSON.parse(result.content[0].text);

      expect(content.priority).toBe('None');
      expect(content.assignee).toBe('Unassigned');
      expect(content.reporter).toBe('Unknown');
      expect(content.components).toEqual([]);
      expect(content.labels).toEqual([]);
      expect(content.fixVersions).toEqual([]);
      expect(content.comments).toEqual([]);
    });
  });

  describe('getRecentIssues', () => {
    const mockRecentIssues = {
      total: 3,
      issues: [
        {
          key: 'PROJ-201',
          fields: {
            summary: 'Recent Issue 1',
            status: { name: 'Open' },
            priority: { name: 'Medium' },
            assignee: { displayName: 'User A' },
            updated: '2024-01-10T00:00:00Z',
            project: { name: 'Project X' }
          }
        },
        {
          key: 'PROJ-202',
          fields: {
            summary: 'Recent Issue 2',
            status: { name: 'Closed' },
            priority: null,
            assignee: null,
            updated: '2024-01-09T00:00:00Z',
            project: { name: 'Project Y' }
          }
        }
      ]
    };

    it('should fetch recent issues with default 7 days', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockRecentIssues)
      });

      const result = await server.getRecentIssues({});
      const content = JSON.parse(result.content[0].text);

      expect(content.period).toBe('Last 7 days');
      expect(content.total).toBe(3);
      expect(content.issues).toHaveLength(2);
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('updated%20%3E%3D%20-7d'),
        expect.any(Object)
      );
    });

    it('should fetch recent issues with custom days parameter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockRecentIssues)
      });

      const result = await server.getRecentIssues({ days: 14, maxResults: 100 });
      const content = JSON.parse(result.content[0].text);

      expect(content.period).toBe('Last 14 days');
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('updated%20%3E%3D%20-14d'),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('maxResults=100'),
        expect.any(Object)
      );
    });

    it('should order issues by updated date descending', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockRecentIssues)
      });

      await server.getRecentIssues({ days: 30 });
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('ORDER%20BY%20updated%20DESC'),
        expect.any(Object)
      );
    });
  });

  describe('getMyTasks', () => {
    const mockTasksResponse = {
      total: 4,
      issues: [
        {
          key: 'TASK-001',
          fields: {
            summary: 'Overdue Task',
            status: { name: 'In Progress' },
            priority: { name: 'High' },
            duedate: '2023-12-01',
            project: { name: 'Project A' },
            issuetype: { name: 'Bug' },
            updated: '2024-01-01T00:00:00Z'
          }
        },
        {
          key: 'TASK-002',
          fields: {
            summary: 'Upcoming Task',
            status: { name: 'To Do' },
            priority: { name: 'Medium' },
            duedate: '2025-01-01',
            project: { name: 'Project B' },
            issuetype: { name: 'Story' },
            updated: '2024-01-02T00:00:00Z'
          }
        },
        {
          key: 'TASK-003',
          fields: {
            summary: 'No Due Date Task',
            status: { name: 'In Progress' },
            priority: { name: 'Low' },
            duedate: null,
            project: { name: 'Project C' },
            issuetype: { name: 'Task' },
            updated: '2024-01-03T00:00:00Z'
          }
        },
        {
          key: 'TASK-004',
          fields: {
            summary: 'Completed Task',
            status: { name: 'Done' },
            priority: null,
            duedate: '2024-01-01',
            project: { name: 'Project D' },
            issuetype: { name: 'Task' },
            updated: '2024-01-04T00:00:00Z'
          }
        }
      ]
    };

    it('should fetch tasks excluding completed by default', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockTasksResponse)
      });

      const result = await server.getMyTasks({});
      const content = JSON.parse(result.content[0].text);

      expect(content.total).toBe(4);
      
      // Check that the JQL excludes completed statuses
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('status%20NOT%20IN%20(%22Done%22%2C%20%22Closed%22%2C%20%22Resolved%22)'),
        expect.any(Object)
      );
    });

    it('should include completed tasks when requested', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockTasksResponse)
      });

      await server.getMyTasks({ includeCompleted: true });
      
      // Should not have the NOT IN clause for status
      expect(mockFetch).toHaveBeenCalledWith(
        expect.not.stringContaining('status%20NOT%20IN'),
        expect.any(Object)
      );
    });

    it('should identify overdue tasks correctly', async () => {
      // Mock date to a specific time for consistent testing
      const mockDate = new Date('2024-01-15');
      vi.setSystemTime(mockDate);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockTasksResponse)
      });

      const result = await server.getMyTasks({});
      const content = JSON.parse(result.content[0].text);

      const overdueTasks = content.tasks.filter(t => t.isOverdue);
      expect(content.overdueTasks).toBe(overdueTasks.length);
      
      // TASK-001 should be overdue (due date: 2023-12-01)
      const overdueTask = content.tasks.find(t => t.key === 'TASK-001');
      expect(overdueTask.isOverdue).toBe(true);
      
      // TASK-002 should not be overdue (due date: 2025-01-01)
      const upcomingTask = content.tasks.find(t => t.key === 'TASK-002');
      expect(upcomingTask.isOverdue).toBe(false);

      vi.useRealTimers();
    });

    it('should calculate task priorities and sort by them', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockTasksResponse)
      });

      const result = await server.getMyTasks({});
      const content = JSON.parse(result.content[0].text);

      // All tasks should have a taskPriority
      content.tasks.forEach(task => {
        expect(task.taskPriority).toBeDefined();
        expect(typeof task.taskPriority).toBe('number');
      });

      // Tasks should be sorted by priority (descending)
      for (let i = 0; i < content.tasks.length - 1; i++) {
        expect(content.tasks[i].taskPriority).toBeGreaterThanOrEqual(content.tasks[i + 1].taskPriority);
      }
    });

    it('should order JQL by priority, due date, and updated', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockTasksResponse)
      });

      await server.getMyTasks({});
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('ORDER%20BY%20priority%20DESC%2C%20duedate%20ASC%2C%20updated%20DESC'),
        expect.any(Object)
      );
    });

    it('should handle maxResults parameter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockTasksResponse)
      });

      await server.getMyTasks({ maxResults: 200 });
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('maxResults=200'),
        expect.any(Object)
      );
    });
  });

  describe('getProjectIssues', () => {
    const mockProjectIssues = {
      total: 10,
      issues: [
        {
          key: 'PROJ-301',
          fields: {
            summary: 'Project Issue 1',
            status: { name: 'Open' },
            priority: { name: 'High' },
            assignee: { displayName: 'Developer 1' },
            created: '2024-01-01T00:00:00Z',
            updated: '2024-01-05T00:00:00Z',
            issuetype: { name: 'Bug' }
          }
        },
        {
          key: 'PROJ-302',
          fields: {
            summary: 'Project Issue 2',
            status: { name: 'In Progress' },
            priority: null,
            assignee: null,
            created: '2024-01-02T00:00:00Z',
            updated: '2024-01-06T00:00:00Z',
            issuetype: { name: 'Story' }
          }
        }
      ]
    };

    it('should fetch issues for a specific project', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockProjectIssues)
      });

      const result = await server.getProjectIssues({ projectKey: 'PROJ' });
      const content = JSON.parse(result.content[0].text);

      expect(content.project).toBe('PROJ');
      expect(content.total).toBe(10);
      expect(content.issues).toHaveLength(2);
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('project%20%3D%20%22PROJ%22'),
        expect.any(Object)
      );
    });

    it('should filter by status when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockProjectIssues)
      });

      await server.getProjectIssues({ projectKey: 'PROJ', status: 'Open' });
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('project%20%3D%20%22PROJ%22%20AND%20status%20%3D%20%22Open%22'),
        expect.any(Object)
      );
    });

    it('should order by priority and updated date', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockProjectIssues)
      });

      await server.getProjectIssues({ projectKey: 'PROJ' });
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('ORDER%20BY%20priority%20DESC%2C%20updated%20DESC'),
        expect.any(Object)
      );
    });

    it('should handle maxResults parameter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockProjectIssues)
      });

      await server.getProjectIssues({ projectKey: 'PROJ', maxResults: 75 });
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('maxResults=75'),
        expect.any(Object)
      );
    });

    it('should include issue URLs', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockProjectIssues)
      });

      const result = await server.getProjectIssues({ projectKey: 'PROJ' });
      const content = JSON.parse(result.content[0].text);
      
      expect(content.issues[0].url).toBe('https://test.atlassian.net/browse/PROJ-301');
      expect(content.issues[1].url).toBe('https://test.atlassian.net/browse/PROJ-302');
    });
  });

  describe('extractTextFromADF', () => {
    it('should extract text from simple ADF document', () => {
      const adfDoc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'This is a test paragraph.'
              }
            ]
          }
        ]
      };

      const result = server.extractTextFromADF(adfDoc);
      expect(result).toBe('This is a test paragraph.\n');
    });

    it('should extract text from complex ADF with multiple paragraphs', () => {
      const adfDoc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'First paragraph.'
              }
            ]
          },
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Second paragraph with '
              },
              {
                type: 'text',
                text: 'multiple text nodes.'
              }
            ]
          }
        ]
      };

      const result = server.extractTextFromADF(adfDoc);
      expect(result).toBe('First paragraph.\nSecond paragraph with multiple text nodes.\n');
    });

    it('should handle ADF with headings and lists', () => {
      const adfDoc = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            content: [
              {
                type: 'text',
                text: 'Main Heading'
              }
            ]
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'text',
                text: 'List item 1'
              }
            ]
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'text',
                text: 'List item 2'
              }
            ]
          }
        ]
      };

      const result = server.extractTextFromADF(adfDoc);
      expect(result).toBe('Main Heading\nList item 1\nList item 2\n');
    });

    it('should handle hard breaks', () => {
      const adfDoc = {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Line 1'
          },
          {
            type: 'hardBreak'
          },
          {
            type: 'text',
            text: 'Line 2'
          }
        ]
      };

      const result = server.extractTextFromADF(adfDoc);
      expect(result).toBe('Line 1\nLine 2\n');
    });

    it('should handle empty or null ADF', () => {
      expect(server.extractTextFromADF(null)).toBe('');
      expect(server.extractTextFromADF({})).toBe('');
      expect(server.extractTextFromADF({ type: 'doc', content: [] })).toBe('');
    });
  });

  describe('calculateTaskPriority', () => {
    it('should calculate priority based on priority field', () => {
      const highPriorityIssue = {
        fields: {
          priority: { name: 'Highest' },
          duedate: null,
          issuetype: { name: 'Task' }
        }
      };
      
      const lowPriorityIssue = {
        fields: {
          priority: { name: 'Lowest' },
          duedate: null,
          issuetype: { name: 'Task' }
        }
      };
      
      const noPriorityIssue = {
        fields: {
          priority: null,
          duedate: null,
          issuetype: { name: 'Task' }
        }
      };

      const highPriority = server.calculateTaskPriority(highPriorityIssue);
      const lowPriority = server.calculateTaskPriority(lowPriorityIssue);
      const noPriority = server.calculateTaskPriority(noPriorityIssue);

      expect(highPriority).toBeGreaterThan(lowPriority);
      expect(noPriority).toBe(2); // Default priority
    });

    it('should add weight for overdue tasks', () => {
      const mockDate = new Date('2024-01-15');
      vi.setSystemTime(mockDate);

      const overdueIssue = {
        fields: {
          priority: { name: 'Medium' },
          duedate: '2024-01-01', // Past date
          issuetype: { name: 'Task' }
        }
      };

      const priority = server.calculateTaskPriority(overdueIssue);
      expect(priority).toBeGreaterThanOrEqual(13); // Medium (3) + Overdue (10)

      vi.useRealTimers();
    });

    it('should add weight for tasks due soon', () => {
      const mockDate = new Date('2024-01-15');
      vi.setSystemTime(mockDate);

      const dueTomorrowIssue = {
        fields: {
          priority: { name: 'Medium' },
          duedate: '2024-01-16', // Tomorrow
          issuetype: { name: 'Task' }
        }
      };

      const dueThisWeekIssue = {
        fields: {
          priority: { name: 'Medium' },
          duedate: '2024-01-20', // 5 days away
          issuetype: { name: 'Task' }
        }
      };

      const dueThisMonthIssue = {
        fields: {
          priority: { name: 'Medium' },
          duedate: '2024-02-10', // ~26 days away
          issuetype: { name: 'Task' }
        }
      };

      const dueLaterIssue = {
        fields: {
          priority: { name: 'Medium' },
          duedate: '2024-12-31', // Far future
          issuetype: { name: 'Task' }
        }
      };

      const tomorrowPriority = server.calculateTaskPriority(dueTomorrowIssue);
      const weekPriority = server.calculateTaskPriority(dueThisWeekIssue);
      const monthPriority = server.calculateTaskPriority(dueThisMonthIssue);
      const laterPriority = server.calculateTaskPriority(dueLaterIssue);

      expect(tomorrowPriority).toBeGreaterThan(weekPriority);
      expect(weekPriority).toBeGreaterThan(monthPriority);
      expect(monthPriority).toBeGreaterThan(laterPriority);

      vi.useRealTimers();
    });

    it('should add weight for issue type', () => {
      const bugIssue = {
        fields: {
          priority: { name: 'Medium' },
          duedate: null,
          issuetype: { name: 'Bug' }
        }
      };

      const storyIssue = {
        fields: {
          priority: { name: 'Medium' },
          duedate: null,
          issuetype: { name: 'Story' }
        }
      };

      const taskIssue = {
        fields: {
          priority: { name: 'Medium' },
          duedate: null,
          issuetype: { name: 'Task' }
        }
      };

      const bugPriority = server.calculateTaskPriority(bugIssue);
      const storyPriority = server.calculateTaskPriority(storyIssue);
      const taskPriority = server.calculateTaskPriority(taskIssue);

      expect(bugPriority).toBeGreaterThan(storyPriority);
      expect(storyPriority).toBeGreaterThan(taskPriority);
    });

    it('should combine multiple priority factors', () => {
      const mockDate = new Date('2024-01-15');
      vi.setSystemTime(mockDate);

      const criticalOverdueBug = {
        fields: {
          priority: { name: 'Highest' },
          duedate: '2024-01-01', // Overdue
          issuetype: { name: 'Bug' }
        }
      };

      const lowPriorityFutureTask = {
        fields: {
          priority: { name: 'Lowest' },
          duedate: '2024-12-31', // Far future
          issuetype: { name: 'Task' }
        }
      };

      const criticalPriority = server.calculateTaskPriority(criticalOverdueBug);
      const lowPriority = server.calculateTaskPriority(lowPriorityFutureTask);

      expect(criticalPriority).toBeGreaterThan(15); // Highest (5) + Overdue (10) + Bug (2)
      expect(lowPriority).toBe(1); // Lowest (1) + no due date weight + Task (0)

      vi.useRealTimers();
    });
  });

  describe('Error Handling', () => {
    it('should handle API authentication errors (401)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: vi.fn().mockResolvedValue('401: Authentication credentials are invalid')
      });

      await expect(server.getAssignedIssues({}))
        .rejects.toThrow('Authentication failed. Please check your JIRA_EMAIL and JIRA_API_TOKEN');
    });

    it('should handle API rate limiting errors (429)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: vi.fn().mockResolvedValue('Rate limit exceeded. Please wait before making another request.')
      });

      await expect(server.searchIssues({ jql: 'test' }))
        .rejects.toThrow('Jira API error: 429 Too Many Requests');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

      await expect(server.getRecentIssues({}))
        .rejects.toThrow('Network timeout');
    });

    it('should handle malformed JSON responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON'))
      });

      await expect(server.getIssueDetails({ issueKey: 'PROJ-123' }))
        .rejects.toThrow('Invalid JSON');
    });

    it('should handle 404 errors for non-existent issues', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: vi.fn().mockResolvedValue('{"errorMessages": ["Issue NONEXISTENT-999 does not exist or you do not have permission to see it."]}')
      });

      await expect(server.getIssueDetails({ issueKey: 'NONEXISTENT-999' }))
        .rejects.toThrow('Issue NONEXISTENT-999 does not exist or you do not have permission to see it.');
    });

    it('should handle server errors (500)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: vi.fn().mockResolvedValue('An unexpected error occurred processing your request.')
      });

      await expect(server.getProjectIssues({ projectKey: 'PROJ' }))
        .rejects.toThrow('Jira API error: 500 Internal Server Error');
    });

    it('should handle 410 Gone errors without fallback', async () => {
      // v3 returns 410 (endpoint removed)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 410,
        statusText: 'Gone',
        text: vi.fn().mockResolvedValue('This API endpoint has been removed.')
      });

      // It should throw error as there's no fallback
      await expect(server.makeJiraRequest('/search/jql'))
        .rejects.toThrow('Jira API endpoint no longer available (410 Gone)');
      
      // Verify it only made one call to v3
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/rest/api/3/search/jql'),
        expect.any(Object)
      );
    });

    it('should handle 410 Gone errors with v3 migration message', async () => {
      // v3 returns 410 with migration message
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 410,
        statusText: 'Gone',
        text: vi.fn().mockResolvedValue('The requested API has been removed. Please migrate to /rest/api/3/search/jql')
      });

      // It should throw error with v3 migration message
      await expect(server.makeJiraRequest('/search/jql'))
        .rejects.toThrow('Jira API v2 has been removed. This server is already configured to use v3');
    });
  });

  describe('Tool Handler Integration', () => {
    let toolHandler;

    beforeEach(() => {
      // Capture the tool handler function
      const callToolHandler = mockServerInstance.setRequestHandler.mock.calls.find(
        call => call[0] === CallToolRequestSchema
      );
      if (callToolHandler) {
        toolHandler = callToolHandler[1];
      }
    });

    it('should handle get_assigned_issues tool call', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ total: 0, issues: [] })
      });

      const result = await toolHandler({
        params: {
          name: 'get_assigned_issues',
          arguments: { status: 'Open' }
        }
      });

      expect(result.content[0].type).toBe('text');
      const content = JSON.parse(result.content[0].text);
      expect(content.total).toBe(0);
    });

    it('should handle search_issues tool call', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ total: 1, issues: [] })
      });

      const result = await toolHandler({
        params: {
          name: 'search_issues',
          arguments: { jql: 'project = TEST' }
        }
      });

      expect(result.content[0].type).toBe('text');
      const content = JSON.parse(result.content[0].text);
      expect(content.jql).toBe('project = TEST');
    });

    it('should handle get_issue_details tool call', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          key: 'TEST-1',
          fields: {
            summary: 'Test',
            status: { name: 'Open' },
            issuetype: { name: 'Task' },
            project: { key: 'TEST', name: 'Test Project' }
          }
        })
      });

      const result = await toolHandler({
        params: {
          name: 'get_issue_details',
          arguments: { issueKey: 'TEST-1' }
        }
      });

      expect(result.content[0].type).toBe('text');
      const content = JSON.parse(result.content[0].text);
      expect(content.key).toBe('TEST-1');
    });

    it('should handle get_recent_issues tool call', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ total: 5, issues: [] })
      });

      const result = await toolHandler({
        params: {
          name: 'get_recent_issues',
          arguments: { days: 3 }
        }
      });

      expect(result.content[0].type).toBe('text');
      const content = JSON.parse(result.content[0].text);
      expect(content.period).toBe('Last 3 days');
    });

    it('should handle get_my_tasks tool call', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ total: 2, issues: [] })
      });

      const result = await toolHandler({
        params: {
          name: 'get_my_tasks',
          arguments: { includeCompleted: true }
        }
      });

      expect(result.content[0].type).toBe('text');
      const content = JSON.parse(result.content[0].text);
      expect(content.total).toBe(2);
    });

    it('should handle get_project_issues tool call', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ total: 15, issues: [] })
      });

      const result = await toolHandler({
        params: {
          name: 'get_project_issues',
          arguments: { projectKey: 'MYPROJ', status: 'Done' }
        }
      });

      expect(result.content[0].type).toBe('text');
      const content = JSON.parse(result.content[0].text);
      expect(content.project).toBe('MYPROJ');
    });

    it('should handle unknown tool error', async () => {
      const result = await toolHandler({
        params: {
          name: 'unknown_tool',
          arguments: {}
        }
      });

      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Error: Unknown tool: unknown_tool');
    });

    it('should handle tool execution errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('API Error'));

      const result = await toolHandler({
        params: {
          name: 'get_assigned_issues',
          arguments: {}
        }
      });

      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Error: API Error');
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete issue lifecycle', async () => {
      // Search for issues
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          total: 1,
          issues: [{
            key: 'PROJ-100',
            fields: {
              summary: 'Found Issue',
              status: { name: 'Open' },
              issuetype: { name: 'Task' },
              project: { name: 'Project' }
            }
          }]
        })
      });

      const searchResult = await server.searchIssues({ jql: 'summary ~ "Found"' });
      const searchContent = JSON.parse(searchResult.content[0].text);
      expect(searchContent.issues[0].key).toBe('PROJ-100');

      // Get detailed information about the found issue
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          key: 'PROJ-100',
          fields: {
            summary: 'Found Issue',
            description: 'Detailed description',
            status: { name: 'Open' },
            priority: { name: 'High' },
            issuetype: { name: 'Task' },
            project: { key: 'PROJ', name: 'Project' },
            comment: { comments: [] }
          }
        })
      });

      const detailResult = await server.getIssueDetails({ issueKey: 'PROJ-100' });
      const detailContent = JSON.parse(detailResult.content[0].text);
      expect(detailContent.description).toBe('Detailed description');
      expect(detailContent.priority).toBe('High');
    });

    it('should handle pagination parameters consistently', async () => {
      const mockLargeResponse = {
        total: 250,
        startAt: 0,
        maxResults: 50,
        issues: Array(50).fill(null).map((_, i) => ({
          key: `PROJ-${i + 1}`,
          fields: {
            summary: `Issue ${i + 1}`,
            status: { name: 'Open' },
            issuetype: { name: 'Task' },
            project: { name: 'Project' }
          }
        }))
      };

      // Test different methods with maxResults
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockLargeResponse)
      });

      const assignedResult = await server.getAssignedIssues({ maxResults: 50 });
      const assignedContent = JSON.parse(assignedResult.content[0].text);
      expect(assignedContent.issues).toHaveLength(50);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockLargeResponse)
      });

      const searchResult = await server.searchIssues({ jql: 'test', maxResults: 50 });
      const searchContent = JSON.parse(searchResult.content[0].text);
      expect(searchContent.issues).toHaveLength(50);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockLargeResponse)
      });

      const recentResult = await server.getRecentIssues({ maxResults: 50 });
      const recentContent = JSON.parse(recentResult.content[0].text);
      expect(recentContent.issues).toHaveLength(50);
    });

    it('should construct proper URLs for different Jira instances', async () => {
      const server1 = await createTestServer({ JIRA_URL: 'https://company1.atlassian.net' });
      const server2 = await createTestServer({ JIRA_URL: 'https://jira.company2.com' });
      
      expect(server1.jiraUrl).toBe('https://company1.atlassian.net');
      expect(server2.jiraUrl).toBe('https://jira.company2.com');
    });

    it('should handle different priority values consistently', async () => {
      const issuesWithDifferentPriorities = {
        total: 5,
        issues: [
          {
            key: 'P-1',
            fields: {
              priority: { name: 'Highest' },
              issuetype: { name: 'Bug' },
              duedate: '2024-01-01'
            }
          },
          {
            key: 'P-2',
            fields: {
              priority: { name: 'High' },
              issuetype: { name: 'Bug' },
              duedate: '2024-01-01'
            }
          },
          {
            key: 'P-3',
            fields: {
              priority: { name: 'Medium' },
              issuetype: { name: 'Bug' },
              duedate: '2024-01-01'
            }
          },
          {
            key: 'P-4',
            fields: {
              priority: { name: 'Low' },
              issuetype: { name: 'Bug' },
              duedate: '2024-01-01'
            }
          },
          {
            key: 'P-5',
            fields: {
              priority: { name: 'Lowest' },
              issuetype: { name: 'Bug' },
              duedate: '2024-01-01'
            }
          }
        ]
      };

      const priorities = issuesWithDifferentPriorities.issues.map(issue => 
        server.calculateTaskPriority(issue)
      );

      // Verify priorities are in descending order
      for (let i = 0; i < priorities.length - 1; i++) {
        expect(priorities[i]).toBeGreaterThan(priorities[i + 1]);
      }
    });
  });

  describe('run method', () => {
    it('should connect to StdioServerTransport', async () => {
      const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      await server.run();
      
      expect(StdioServerTransport).toHaveBeenCalled();
      expect(mockServerInstance.connect).toHaveBeenCalled();
      expect(mockConsoleError).toHaveBeenCalledWith('Jira MCP server running on stdio');
      
      mockConsoleError.mockRestore();
    });

    it('should handle connection errors', async () => {
      const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockServerInstance.connect.mockRejectedValueOnce(new Error('Connection failed'));
      
      await expect(server.run()).rejects.toThrow('Connection failed');
      
      mockConsoleError.mockRestore();
    });
  });
});