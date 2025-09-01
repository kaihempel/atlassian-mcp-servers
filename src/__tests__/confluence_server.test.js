import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest';
import fetch from 'node-fetch';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// Mock the modules before importing the server
vi.mock('node-fetch');
vi.mock('@modelcontextprotocol/sdk/server/index.js');
vi.mock('@modelcontextprotocol/sdk/server/stdio.js');

// Set environment variables before importing the server
process.env.CONFLUENCE_URL = 'https://test.atlassian.net/wiki';
process.env.CONFLUENCE_EMAIL = 'test@example.com';
process.env.CONFLUENCE_API_TOKEN = 'test-token-123';

// Import the server class
import { ConfluenceMCPServer } from '../confluence_server.js';

// Helper to create a test server instance with custom environment
function createTestServer(env = {}) {
  // Save current env
  const savedEnv = { ...process.env };
  
  // Set test environment variables
  Object.assign(process.env, {
    CONFLUENCE_URL: env.CONFLUENCE_URL || 'https://test.atlassian.net/wiki',
    CONFLUENCE_EMAIL: env.CONFLUENCE_EMAIL || 'test@example.com',
    CONFLUENCE_API_TOKEN: env.CONFLUENCE_API_TOKEN || 'test-token-123',
    ...env
  });

  // Create a test instance
  const server = new ConfluenceMCPServer();
  
  // Restore env
  process.env = savedEnv;
  
  return server;
}

describe('ConfluenceMCPServer', () => {
  let server;
  let mockFetch;
  let mockServerInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock the Server constructor
    mockServerInstance = {
      setRequestHandler: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined)
    };
    Server.mockImplementation(() => mockServerInstance);
    
    // Mock StdioServerTransport
    StdioServerTransport.mockImplementation(() => ({}));
    
    // Create test server
    server = createTestServer();
    mockFetch = fetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('Constructor and Initialization', () => {
    it('should initialize with required environment variables', async () => {
      expect(server.confluenceUrl).toBe('https://test.atlassian.net/wiki');
      expect(server.confluenceEmail).toBe('test@example.com');
      expect(server.confluenceApiToken).toBe('test-token-123');
    });

    it('should exit if required environment variables are missing', () => {
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('Process exited');
      });
      const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // Save current env
      const savedEnv = { ...process.env };
      
      // Clear required env vars
      delete process.env.CONFLUENCE_URL;
      delete process.env.CONFLUENCE_EMAIL;
      delete process.env.CONFLUENCE_API_TOKEN;
      
      // This will trigger process.exit
      expect(() => {
        new ConfluenceMCPServer();
      }).toThrow('Process exited');
      
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Missing required environment variables: CONFLUENCE_URL, CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN'
      );
      expect(mockExit).toHaveBeenCalledWith(1);
      
      // Restore env
      process.env = savedEnv;
      
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

  describe('getPageComments', () => {
    it('should fetch comments using v2 API when available', async () => {
      const mockComments = {
        results: [
          {
            id: 'comment1',
            version: {
              createdBy: { publicName: 'John Doe', email: 'john@example.com' },
              createdAt: '2024-01-01T00:00:00Z',
              number: 1
            },
            body: { value: '<p>Test comment</p>' }
          }
        ]
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockComments)
      });

      const result = await server.getPageComments({ pageId: '12345' });
      const content = JSON.parse(result.content[0].text);

      expect(content.pageId).toBe('12345');
      expect(content.totalComments).toBe(1);
      expect(content.comments[0].author).toBe('John Doe');
      expect(content.comments[0].content).toBe('Test comment');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.atlassian.net/wiki/api/v2/pages/12345/footer-comments',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': expect.stringContaining('Basic')
          })
        })
      );
    });

    it('should fallback to v1 API when v2 API fails', async () => {
      // First call to v2 API fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404
      });

      // Second call to v1 API succeeds
      const mockV1Comments = {
        results: [
          {
            id: 'comment1',
            history: {
              createdBy: { displayName: 'Jane Doe', email: 'jane@example.com' },
              createdDate: '2024-01-01T00:00:00Z'
            },
            body: { view: { value: '<p>Test comment v1</p>' } },
            version: { number: 1 }
          }
        ],
        size: 1
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockV1Comments)
      });

      const result = await server.getPageComments({ pageId: '12345' });
      const content = JSON.parse(result.content[0].text);

      expect(content.pageId).toBe('12345');
      expect(content.totalComments).toBe(1);
      expect(content.comments[0].author).toBe('Jane Doe');
      expect(content.comments[0].content).toBe('Test comment v1');
    });

    it('should handle errors when fetching comments', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(server.getPageComments({ pageId: '12345' })).rejects.toThrow('Failed to get page comments');
    });
  });

  describe('createPage', () => {
    it('should validate required parameters', async () => {
      await expect(server.createPage({ spaceKey: '', title: '', content: '' }))
        .rejects.toThrow('Missing required parameters');
    });

    it('should validate title length', async () => {
      const longTitle = 'a'.repeat(256);
      await expect(server.createPage({ 
        spaceKey: 'TEST', 
        title: longTitle, 
        content: 'content' 
      })).rejects.toThrow('Title exceeds maximum length');
    });

    it('should validate spaceKey format', async () => {
      await expect(server.createPage({ 
        spaceKey: 'test-space!', 
        title: 'Test', 
        content: 'content' 
      })).rejects.toThrow('Invalid spaceKey format');
    });

    it('should create page using v2 API when available', async () => {
      // Mock v2 API availability check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ results: [] })
      });

      // Mock space ID lookup
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ 
          results: [{ id: 'space-123' }] 
        })
      });

      // Mock page creation
      const createdPage = {
        id: 'page-123',
        title: 'Test Page',
        version: { number: 1 }
      };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(createdPage)
      });

      const result = await server.createPage({
        spaceKey: 'TEST',
        title: 'Test Page',
        content: '<p>Test content</p>',
        parentPageId: 'parent-123'
      });

      const content = JSON.parse(result.content[0].text);
      
      expect(content.success).toBe(true);
      expect(content.pageId).toBe('page-123');
      expect(content.title).toBe('Test Page');
      expect(content.message).toContain('v2 API');
    });

    it('should fallback to v1 API when v2 is not available', async () => {
      // Mock v2 API availability check to fail
      mockFetch.mockResolvedValueOnce({
        ok: false
      });

      // Mock v1 API page creation
      const createdPage = {
        id: 'page-456',
        title: 'Test Page V1',
        version: { number: 1 },
        _links: { webui: '/spaces/TEST/pages/page-456' }
      };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(createdPage)
      });

      const result = await server.createPage({
        spaceKey: 'TEST',
        title: 'Test Page V1',
        content: 'Simple content'
      });

      const content = JSON.parse(result.content[0].text);
      
      expect(content.success).toBe(true);
      expect(content.pageId).toBe('page-456');
      expect(content.message).toContain('v1 API');
    });

    it('should handle parent page ID in v1 API', async () => {
      // Mock v2 API availability check to fail
      mockFetch.mockResolvedValueOnce({
        ok: false
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'page-789',
          title: 'Child Page',
          version: { number: 1 },
          _links: { webui: '/spaces/TEST/pages/page-789' }
        })
      });

      await server.createPage({
        spaceKey: 'TEST',
        title: 'Child Page',
        content: 'Child content',
        parentPageId: 'parent-456'
      });

      // Verify the request included ancestors
      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"ancestors":[{"id":"parent-456"}]')
        })
      );
    });
  });

  describe('updatePage', () => {
    it('should validate required parameters', async () => {
      await expect(server.updatePage({ pageId: '', content: '' }))
        .rejects.toThrow('Missing required parameters');
    });

    it('should validate pageId format', async () => {
      await expect(server.updatePage({ 
        pageId: 'not-a-number', 
        content: 'content' 
      })).rejects.toThrow('Invalid pageId format');
    });

    it('should validate title length when provided', async () => {
      const longTitle = 'a'.repeat(256);
      await expect(server.updatePage({ 
        pageId: '123', 
        title: longTitle,
        content: 'content' 
      })).rejects.toThrow('Title exceeds maximum length');
    });

    it('should update page using v2 API when available', async () => {
      // Mock getting current page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: '123',
          title: 'Current Title',
          version: { number: 5 },
          space: { key: 'TEST' }
        })
      });

      // Mock v2 API availability check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ results: [] })
      });

      // Mock page update
      const updatedPage = {
        id: '123',
        title: 'Updated Title',
        version: { number: 6 }
      };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(updatedPage)
      });

      const result = await server.updatePage({
        pageId: '123',
        title: 'Updated Title',
        content: '<p>Updated content</p>'
      });

      const content = JSON.parse(result.content[0].text);
      
      expect(content.success).toBe(true);
      expect(content.pageId).toBe('123');
      expect(content.title).toBe('Updated Title');
      expect(content.version).toBe(6);
      expect(content.message).toContain('v2 API');
    });

    it('should fallback to v1 API when v2 is not available', async () => {
      // Mock getting current page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: '456',
          title: 'Current Title',
          version: { number: 3 },
          space: { key: 'TEST' }
        })
      });

      // Mock v2 API availability check to fail
      mockFetch.mockResolvedValueOnce({
        ok: false
      });

      // Mock v1 API page update
      const updatedPage = {
        id: '456',
        title: 'Updated Title V1',
        version: { number: 4 },
        _links: { webui: '/spaces/TEST/pages/456' }
      };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(updatedPage)
      });

      const result = await server.updatePage({
        pageId: '456',
        content: 'Updated content'
      });

      const content = JSON.parse(result.content[0].text);
      
      expect(content.success).toBe(true);
      expect(content.pageId).toBe('456');
      expect(content.message).toContain('v1 API');
    });

    it('should preserve existing title when not provided', async () => {
      // Mock getting current page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: '789',
          title: 'Existing Title',
          version: { number: 2 },
          space: { key: 'TEST' }
        })
      });

      // Mock v2 API availability check to fail
      mockFetch.mockResolvedValueOnce({
        ok: false
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: '789',
          title: 'Existing Title',
          version: { number: 3 },
          _links: { webui: '/spaces/TEST/pages/789' }
        })
      });

      await server.updatePage({
        pageId: '789',
        content: 'New content only'
      });

      // Verify the request preserved the existing title
      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"title":"Existing Title"')
        })
      );
    });
  });

  describe('createTaskPage', () => {
    it('should create a task page with structured format', async () => {
      const tasks = [
        {
          title: 'High priority task',
          description: 'Important task description',
          priority: 'High',
          dueDate: '2024-12-31',
          assignee: 'john@example.com'
        },
        {
          title: 'Medium priority task',
          priority: 'Medium'
        },
        {
          title: 'Low priority task',
          priority: 'Low'
        },
        {
          title: 'Unprioritized task'
        }
      ];

      // Mock v2 API availability check to fail
      mockFetch.mockResolvedValueOnce({
        ok: false
      });

      // Mock page creation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'task-page-123',
          title: 'Tasks - December 1, 2024',
          version: { number: 1 },
          _links: { webui: '/spaces/TEST/pages/task-page-123' }
        })
      });

      const result = await server.createTaskPage({
        spaceKey: 'TEST',
        tasks: tasks
      });

      const content = JSON.parse(result.content[0].text);
      
      expect(content.success).toBe(true);
      expect(content.pageId).toBe('task-page-123');
      
      // Verify the created content structure
      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const requestBody = JSON.parse(lastCall[1].body);
      const pageContent = requestBody.body.storage.value;
      
      expect(pageContent).toContain('<h1>Task List</h1>');
      expect(pageContent).toContain('<h2>High Priority Tasks</h2>');
      expect(pageContent).toContain('<h2>Medium Priority Tasks</h2>');
      expect(pageContent).toContain('<h2>Low Priority Tasks</h2>');
      expect(pageContent).toContain('<h2>Unprioritized Priority Tasks</h2>');
      expect(pageContent).toContain('<ac:task-list>');
      expect(pageContent).toContain('<ac:task>');
      expect(pageContent).toContain('High priority task');
    });

    it('should use custom title when provided', async () => {
      // Mock v2 API availability check to fail
      mockFetch.mockResolvedValueOnce({
        ok: false
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'task-page-456',
          title: 'Custom Task List',
          version: { number: 1 },
          _links: { webui: '/spaces/TEST/pages/task-page-456' }
        })
      });

      await server.createTaskPage({
        spaceKey: 'TEST',
        title: 'Custom Task List',
        tasks: [{ title: 'Test task' }]
      });

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const requestBody = JSON.parse(lastCall[1].body);
      
      expect(requestBody.title).toBe('Custom Task List');
    });

    it('should escape HTML in task content', async () => {
      const tasks = [
        {
          title: 'Task with <script>alert("XSS")</script>',
          description: 'Description with <b>HTML</b> & special chars',
          assignee: 'user@example.com <script>'
        }
      ];

      // Mock v2 API availability check to fail
      mockFetch.mockResolvedValueOnce({
        ok: false
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'task-page-789',
          title: 'Tasks',
          version: { number: 1 },
          _links: { webui: '/spaces/TEST/pages/task-page-789' }
        })
      });

      await server.createTaskPage({
        spaceKey: 'TEST',
        tasks: tasks
      });

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const requestBody = JSON.parse(lastCall[1].body);
      const pageContent = requestBody.body.storage.value;
      
      expect(pageContent).toContain('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
      expect(pageContent).toContain('&lt;b&gt;HTML&lt;/b&gt; &amp; special chars');
      expect(pageContent).not.toContain('<script>');
    });

    it('should include metadata fields when provided', async () => {
      const tasks = [
        {
          title: 'Task with metadata',
          dueDate: '2024-12-31',
          assignee: 'john@example.com',
          source: 'Meeting notes'
        }
      ];

      // Mock v2 API availability check to fail
      mockFetch.mockResolvedValueOnce({
        ok: false
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'task-page-999',
          title: 'Tasks',
          version: { number: 1 },
          _links: { webui: '/spaces/TEST/pages/task-page-999' }
        })
      });

      await server.createTaskPage({
        spaceKey: 'TEST',
        tasks: tasks
      });

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const requestBody = JSON.parse(lastCall[1].body);
      const pageContent = requestBody.body.storage.value;
      
      expect(pageContent).toContain('Due: 2024-12-31');
      expect(pageContent).toContain('Assignee: john@example.com');
      expect(pageContent).toContain('Source: Meeting notes');
    });
  });

  describe('Helper Methods', () => {
    describe('stripHtmlTags', () => {
      it('should remove HTML tags and preserve text', () => {
        const html = '<p>Test <b>paragraph</b> with <a href="#">link</a></p>';
        const result = server.stripHtmlTags(html);
        
        expect(result).toBe('Test paragraph with link');
      });

      it('should handle Confluence-specific macros', () => {
        const html = '<ac:task><ac:task-body>Task content</ac:task-body></ac:task>';
        const result = server.stripHtmlTags(html);
        
        expect(result).toBe('Task content');
      });

      it('should preserve line breaks', () => {
        const html = '<p>Line 1</p><br/><p>Line 2</p><div>Line 3</div>';
        const result = server.stripHtmlTags(html);
        
        expect(result).toContain('Line 1');
        expect(result).toContain('Line 2');
        expect(result).toContain('Line 3');
      });

      it('should decode HTML entities', () => {
        const html = '&lt;script&gt;&amp;&quot;test&quot;&amp;&gt;';
        const result = server.stripHtmlTags(html);
        
        expect(result).toBe('<script>&"test"&>');
      });

      it('should handle list items', () => {
        const html = '<ul><li>Item 1</li><li>Item 2</li></ul>';
        const result = server.stripHtmlTags(html);
        
        expect(result).toContain('• Item 1');
        expect(result).toContain('• Item 2');
      });

      it('should handle empty or null input', () => {
        expect(server.stripHtmlTags('')).toBe('');
        expect(server.stripHtmlTags(null)).toBe('');
        expect(server.stripHtmlTags(undefined)).toBe('');
      });
    });

    describe('extractTasksFromContent', () => {
      it('should extract tasks with checkbox format', () => {
        const content = `
          Some text
          - [ ] Task 1
          - [ ] Task 2 with more details
          * [ ] Task 3 with asterisk
        `;
        
        const tasks = server.extractTasksFromContent(content);
        
        expect(tasks).toHaveLength(3);
        expect(tasks[0].text).toBe('Task 1');
        expect(tasks[1].text).toBe('Task 2 with more details');
        expect(tasks[2].text).toBe('Task 3 with asterisk');
      });

      it('should extract TODO markers', () => {
        const content = `
          - TODO: Implement feature
          * TODO Complete documentation
          1. TODO: Review code
        `;
        
        const tasks = server.extractTasksFromContent(content);
        
        expect(tasks.some(t => t.text.includes('Implement feature'))).toBe(true);
        expect(tasks.some(t => t.text.includes('Complete documentation'))).toBe(true);
        expect(tasks.some(t => t.text.includes('Review code'))).toBe(true);
      });

      it('should extract ACTION items', () => {
        const content = `
          - ACTION: Schedule meeting
          ACTION ITEM: Send report
          - ACTION: Follow up with client
        `;
        
        const tasks = server.extractTasksFromContent(content);
        
        // Check if tasks were extracted
        expect(tasks.length).toBeGreaterThan(0);
        
        // Check for specific content in extracted tasks
        const taskTexts = tasks.map(t => t.text.toLowerCase());
        expect(taskTexts.some(text => text.includes('schedule meeting'))).toBe(true);
        expect(taskTexts.some(text => text.includes('send report'))).toBe(true);
        expect(taskTexts.some(text => text.includes('follow up with client'))).toBe(true);
      });

      it('should extract @mention tasks', () => {
        const content = '@john to review the document';
        
        const tasks = server.extractTasksFromContent(content);
        
        expect(tasks.some(t => t.text.includes('review the document'))).toBe(true);
      });

      it('should extract tasks from sections', () => {
        const content = `
          Action Items:
          Review budget proposal
          Update project timeline
          Contact stakeholders
        `;
        
        const tasks = server.extractTasksFromContent(content);
        
        expect(tasks.some(t => t.text.includes('Review budget proposal'))).toBe(true);
        expect(tasks.some(t => t.text.includes('Update project timeline'))).toBe(true);
        expect(tasks.some(t => t.text.includes('Contact stakeholders'))).toBe(true);
      });

      it('should filter out too short tasks', () => {
        const content = `
          - [ ] Do
          - [ ] Valid task with enough content
        `;
        
        const tasks = server.extractTasksFromContent(content);
        
        expect(tasks).toHaveLength(1);
        expect(tasks[0].text).toBe('Valid task with enough content');
      });

      it('should filter out too long tasks', () => {
        const longTask = 'a'.repeat(501);
        const content = `
          - [ ] ${longTask}
          - [ ] Normal task
        `;
        
        const tasks = server.extractTasksFromContent(content);
        
        expect(tasks).toHaveLength(1);
        expect(tasks[0].text).toBe('Normal task');
      });

      it('should remove duplicate tasks', () => {
        const content = `
          - [ ] Duplicate task here
          - TODO: Duplicate task here
        `;
        
        const tasks = server.extractTasksFromContent(content);
        
        // Should remove the duplicate based on normalized text
        expect(tasks).toHaveLength(1);
        expect(tasks[0].text).toBe('Duplicate task here');
      });

      it('should filter out non-task sentences', () => {
        const content = `
          - [ ] The weather is nice
          - [ ] And this is not a task
          - [ ] Complete the report
        `;
        
        const tasks = server.extractTasksFromContent(content);
        
        expect(tasks).toHaveLength(1);
        expect(tasks[0].text).toBe('Complete the report');
      });
    });

    describe('calculatePageTaskPriority', () => {
      it('should calculate priority based on title keywords', () => {
        const priority1 = server.calculatePageTaskPriority('Urgent Meeting Notes', '');
        const priority2 = server.calculatePageTaskPriority('Regular Notes', '');
        
        expect(priority1).toBeGreaterThan(priority2);
      });

      it('should calculate priority based on content keywords', () => {
        const content1 = 'This is urgent and critical. ASAP needed.';
        const content2 = 'Regular content without urgency.';
        
        const priority1 = server.calculatePageTaskPriority('', content1);
        const priority2 = server.calculatePageTaskPriority('', content2);
        
        expect(priority1).toBeGreaterThan(priority2);
      });

      it('should consider deadline mentions', () => {
        const content = 'Deadline is tomorrow. Due date: Dec 31. Must complete by Friday.';
        const priority = server.calculatePageTaskPriority('', content);
        
        expect(priority).toBeGreaterThan(0);
      });

      it('should consider action items and tasks', () => {
        const content = 'Action item: review. TODO: complete. Task: implement. Follow-up needed.';
        const priority = server.calculatePageTaskPriority('', content);
        
        expect(priority).toBeGreaterThan(0);
      });

      it('should consider @mentions', () => {
        const content = '@john please review @jane for approval @team check this';
        const priority = server.calculatePageTaskPriority('', content);
        
        expect(priority).toBeGreaterThan(0);
      });

      it('should cap action matches to avoid inflation', () => {
        const content = 'action item '.repeat(20);
        const priority = server.calculatePageTaskPriority('', content);
        
        // Should be capped, not 20 * matches
        expect(priority).toBeLessThanOrEqual(50);
      });

      it('should combine multiple factors', () => {
        const title = 'Urgent Meeting Action Items';
        const content = 'Critical deadline tomorrow. @john to complete ASAP.';
        
        const priority = server.calculatePageTaskPriority(title, content);
        
        expect(priority).toBeGreaterThan(15); // Multiple factors should add up
      });
    });

    describe('checkV2ApiAvailability', () => {
      it('should check and cache v2 API availability', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({})
        });

        const result1 = await server.checkV2ApiAvailability();
        expect(result1).toBe(true);
        
        // Second call should use cached value
        const result2 = await server.checkV2ApiAvailability();
        expect(result2).toBe(true);
        
        // Fetch should only be called once due to caching
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      it('should return false when v2 API is not available', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false
        });

        const result = await server.checkV2ApiAvailability();
        expect(result).toBe(false);
      });

      it('should handle network errors gracefully', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const result = await server.checkV2ApiAvailability();
        expect(result).toBe(false);
      });
    });

    describe('getSpaceIdFromKey', () => {
      it('should get space ID using v2 API', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            results: [{ id: 'space-id-123' }]
          })
        });

        const spaceId = await server.getSpaceIdFromKey('TEST');
        
        expect(spaceId).toBe('space-id-123');
        expect(mockFetch).toHaveBeenCalledWith(
          'https://test.atlassian.net/wiki/api/v2/spaces?keys=TEST',
          expect.any(Object)
        );
      });

      it('should fallback to v1 API when v2 fails', async () => {
        // v2 API fails
        mockFetch.mockResolvedValueOnce({
          ok: false
        });

        // v1 API succeeds
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            id: 'space-id-456'
          })
        });

        const spaceId = await server.getSpaceIdFromKey('TEST');
        
        expect(spaceId).toBe('space-id-456');
      });

      it('should throw error when space not found', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Space not found'));

        await expect(server.getSpaceIdFromKey('INVALID')).rejects.toThrow(
          'Failed to get space ID for key INVALID'
        );
      });
    });

    describe('ensureStorageFormat', () => {
      it('should wrap plain text in paragraph tags', () => {
        const result = server.ensureStorageFormat('Plain text content');
        
        expect(result).toBe('<p>Plain text content</p>');
      });

      it('should preserve existing HTML', () => {
        const html = '<h1>Title</h1><p>Content</p>';
        const result = server.ensureStorageFormat(html);
        
        expect(result).toBe(html);
      });

      it('should detect HTML tags correctly', () => {
        const mixed = 'Text with <b>bold</b> content';
        const result = server.ensureStorageFormat(mixed);
        
        expect(result).toBe(mixed);
      });
    });

    describe('escapeHtml', () => {
      it('should escape HTML special characters', () => {
        const input = '<script>alert("XSS")</script> & more';
        const result = server.escapeHtml(input);
        
        expect(result).toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt; &amp; more');
      });

      it('should escape single quotes', () => {
        const input = "It's a test";
        const result = server.escapeHtml(input);
        
        expect(result).toBe('It&#39;s a test');
      });

      it('should handle all special characters', () => {
        const input = '& < > " \'';
        const result = server.escapeHtml(input);
        
        expect(result).toBe('&amp; &lt; &gt; &quot; &#39;');
      });
    });
  });

  describe('getPageTasks', () => {
    it('should extract tasks from multiple pages in parallel', async () => {
      const searchResponse = {
        results: [
          {
            content: {
              id: 'page1',
              type: 'page',
              title: 'Meeting Notes',
              space: { name: 'TEST' },
              history: { lastUpdated: { when: '2024-01-01' } },
              _links: { webui: '/pages/page1' }
            }
          },
          {
            content: {
              id: 'page2',
              type: 'page',
              title: 'Action Items',
              space: { name: 'TEST' },
              history: { lastUpdated: { when: '2024-01-02' } },
              _links: { webui: '/pages/page2' }
            }
          }
        ]
      };

      // Mock search request
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(searchResponse)
      });

      // Mock page content requests
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          body: { storage: { value: '<p>- TODO: Task from page one that needs completion</p>' } }
        })
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          body: { storage: { value: '<p>- ACTION: Task from page two that needs action</p>' } }
        })
      });

      const result = await server.getPageTasks({
        query: 'task',
        limit: 10,
        spaceKey: 'TEST'
      });

      const content = JSON.parse(result.content[0].text);
      
      expect(content.totalPagesSearched).toBe(2);
      expect(content.pagesWithTasks).toBe(2);
      expect(content.pages).toHaveLength(2);
      expect(content.pages[0].extractedTasks).toBeDefined();
    });

    it('should limit tasks per page', async () => {
      const searchResponse = {
        results: [
          {
            content: {
              id: 'page1',
              type: 'page',
              title: 'Many Tasks',
              space: { name: 'TEST' },
              history: { lastUpdated: { when: '2024-01-01' } },
              _links: { webui: '/pages/page1' }
            }
          }
        ]
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(searchResponse)
      });

      // Create content with many tasks
      let manyTasksContent = '<ul>';
      for (let i = 1; i <= 10; i++) {
        manyTasksContent += `<li>TODO: Task number ${i} that needs to be completed</li>`;
      }
      manyTasksContent += '</ul>';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          body: { storage: { value: manyTasksContent } }
        })
      });

      const result = await server.getPageTasks({ query: 'task' });
      const content = JSON.parse(result.content[0].text);
      
      expect(content.pages).toHaveLength(1);
      expect(content.pages[0].extractedTasks.length).toBeLessThanOrEqual(5); // MAX_TASKS_PER_PAGE
      expect(content.pages[0].taskCount).toBeGreaterThan(5);
    });

    it('should handle page processing errors gracefully', async () => {
      const searchResponse = {
        results: [
          {
            content: {
              id: 'page1',
              type: 'page',
              title: 'Page 1',
              space: { name: 'TEST' },
              history: { lastUpdated: { when: '2024-01-01' } },
              _links: { webui: '/pages/page1' }
            }
          },
          {
            content: {
              id: 'page2',
              type: 'page',
              title: 'Page 2',
              space: { name: 'TEST' },
              history: { lastUpdated: { when: '2024-01-02' } },
              _links: { webui: '/pages/page2' }
            }
          }
        ]
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(searchResponse)
      });

      // First page fails
      mockFetch.mockRejectedValueOnce(new Error('Failed to fetch page'));

      // Second page succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          body: { storage: { value: '<p>- TODO: Task from page two that needs work</p>' } }
        })
      });

      const mockWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await server.getPageTasks({ query: 'task' });
      const content = JSON.parse(result.content[0].text);
      
      expect(content.pagesWithTasks).toBe(1);
      expect(content.pages[0].title).toBe('Page 2');
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('Failed to process page page1'));
      
      mockWarn.mockRestore();
    });

    it('should sort pages by priority', async () => {
      const searchResponse = {
        results: [
          {
            content: {
              id: 'page1',
              type: 'page',
              title: 'Low Priority',
              space: { name: 'TEST' },
              history: { lastUpdated: { when: '2024-01-01' } },
              _links: { webui: '/pages/page1' }
            }
          },
          {
            content: {
              id: 'page2',
              type: 'page',
              title: 'URGENT: High Priority',
              space: { name: 'TEST' },
              history: { lastUpdated: { when: '2024-01-02' } },
              _links: { webui: '/pages/page2' }
            }
          }
        ]
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(searchResponse)
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          body: { storage: { value: '<p>- TODO: Normal task that needs attention</p>' } }
        })
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          body: { storage: { value: '<p>- TODO: Critical task ASAP that is urgent</p>' } }
        })
      });

      const result = await server.getPageTasks({ query: 'task' });
      const content = JSON.parse(result.content[0].text);
      
      expect(content.pages[0].title).toBe('URGENT: High Priority');
      expect(content.pages[0].priority).toBeGreaterThan(content.pages[1].priority);
    });

    it('should filter out non-page results', async () => {
      const searchResponse = {
        results: [
          {
            content: {
              id: 'page1',
              type: 'page',
              title: 'Page',
              space: { name: 'TEST' },
              history: { lastUpdated: { when: '2024-01-01' } },
              _links: { webui: '/pages/page1' }
            }
          },
          {
            content: {
              id: 'blog1',
              type: 'blogpost',
              title: 'Blog Post',
              space: { name: 'TEST' },
              history: { lastUpdated: { when: '2024-01-02' } },
              _links: { webui: '/blogs/blog1' }
            }
          }
        ]
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(searchResponse)
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          body: { storage: { value: '<p>- TODO: Task from page that needs work</p>' } }
        })
      });

      const result = await server.getPageTasks({ query: 'task' });
      const content = JSON.parse(result.content[0].text);
      
      // totalPagesSearched is the total results count (including blogposts)
      // but pages array only contains actual pages with tasks
      expect(content.totalPagesSearched).toBe(2);  // Total results
      expect(content.pagesWithTasks).toBe(1);  // Only pages with tasks
      expect(content.pages).toHaveLength(1);
      expect(content.pages[0].title).toBe('Page');
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors with descriptive messages', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      });

      await expect(server.searchPages({ query: 'test' }))
        .rejects.toThrow('Confluence API error: 401 Unauthorized');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

      await expect(server.getSpaces({}))
        .rejects.toThrow('Network timeout');
    });

    it('should handle malformed JSON responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON'))
      });

      await expect(server.getRecentPages({}))
        .rejects.toThrow('Invalid JSON');
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete page lifecycle', async () => {
      // Test creating a page
      mockFetch.mockResolvedValueOnce({ ok: false }); // v2 check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: vi.fn().mockResolvedValue({
          id: '12345',
          title: 'New Page',
          version: { number: 1 },
          _links: { webui: '/pages/12345' }
        })
      });

      const createResult = await server.createPage({
        spaceKey: 'TEST',
        title: 'New Page',
        content: 'Initial content'
      });

      const createContent = JSON.parse(createResult.content[0].text);
      expect(createContent.success).toBe(true);
      expect(createContent.pageId).toBe('12345');
      expect(createContent.title).toBe('New Page');
      expect(createContent.version).toBe(1);

      // Reset mocks for update test
      vi.clearAllMocks();
      
      // Create new server instance for update test to ensure clean state
      const server2 = createTestServer();
      
      // Test updating the page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: vi.fn().mockResolvedValue({
          id: '12345',
          title: 'New Page',
          version: { number: 1 },
          space: { key: 'TEST' }
        })
      });

      mockFetch.mockResolvedValueOnce({ ok: false }); // v2 check

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: vi.fn().mockResolvedValue({
          id: '12345',
          title: 'Updated Page',
          version: { number: 2 },
          _links: { webui: '/pages/12345' }
        })
      });

      const updateResult = await server2.updatePage({
        pageId: '12345',
        title: 'Updated Page',
        content: 'Updated content'
      });

      const updateContent = JSON.parse(updateResult.content[0].text);
      expect(updateContent.success).toBe(true);
      expect(updateContent.pageId).toBe('12345');
      expect(updateContent.title).toBe('Updated Page');
      expect(updateContent.version).toBe(2);
    });

    it('should handle v2 to v1 API fallback consistently', async () => {
      // First operation uses v2
      mockFetch.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({}) }); // v2 available
      server._v2ApiAvailable = null; // Reset cache

      const v2Available = await server.checkV2ApiAvailability();
      expect(v2Available).toBe(true);

      // Simulate v2 becoming unavailable
      server._v2ApiAvailable = null; // Reset cache
      mockFetch.mockResolvedValueOnce({ ok: false }); // v2 not available

      const v2NotAvailable = await server.checkV2ApiAvailability();
      expect(v2NotAvailable).toBe(false);

      // Subsequent operations should use v1
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          results: [],
          totalSize: 0
        })
      });

      const result = await server.searchPages({ query: 'test' });
      expect(result.content[0].text).toBeDefined();
    });
  });
});