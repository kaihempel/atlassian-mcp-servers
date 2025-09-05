# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- `npm start:jira` - Start the Jira MCP server
- `npm start:confluence` - Start the Confluence MCP server  
- `npm dev:jira` - Start Jira server with Node.js debugger enabled
- `npm dev:confluence` - Start Confluence server with Node.js debugger enabled

### Testing
- `npm test` - Run tests with Vitest
- `npm run test:ui` - Run tests with Vitest UI
- `npm run test:run` - Run tests once without watching
- `npm run test:coverage` - Run tests with coverage report

## Architecture

This repository contains MCP (Model Context Protocol) servers for integrating with Atlassian products.

### Structure
- **src/jira_server.js** - MCP server for Jira integration using @modelcontextprotocol/sdk
- **src/confluence_server.js** - MCP server for Confluence integration using @modelcontextprotocol/sdk

Both servers:
- Use StdioServerTransport for communication
- Require environment variables for authentication (API tokens)
- Implement tool handlers for various operations
- Use node-fetch for making API calls to Atlassian services
- Export server classes for testing purposes
- Include comprehensive test suites with Vitest

### Environment Variables Required

#### Jira Server
- `JIRA_URL` - Your Jira instance URL (e.g., https://yourcompany.atlassian.net)
- `JIRA_EMAIL` - Your Atlassian account email
- `JIRA_API_TOKEN` - Jira API token for authentication
- `LOG_LEVEL` - (Optional) Logging level: DEBUG, WARNING, or ERROR (default: DEBUG)

#### Confluence Server  
- `CONFLUENCE_URL` - Your Confluence instance URL (e.g., https://yourcompany.atlassian.net/wiki)
- `CONFLUENCE_EMAIL` - Your Atlassian account email
- `CONFLUENCE_API_TOKEN` - Confluence API token for authentication

## Available Tools

### Jira Server Tools
- `get_assigned_issues` - Get issues assigned to the current user
- `search_issues` - Search issues using JQL (Jira Query Language)
- `get_issue_details` - Get detailed information about a specific issue
- `get_recent_issues` - Get recently created or updated issues
- `get_my_tasks` - Get all tasks assigned to me with priority and due date info
- `get_project_issues` - Get issues from a specific project

### Confluence Server Tools
- `search_pages` - Search Confluence pages by title or content
- `get_page_content` - Get full content of a specific page
- `get_recent_pages` - Get recently created or updated pages
- `get_my_pages` - Get pages created or modified by the current user
- `get_page_tasks` - Extract tasks and action items from Confluence pages
- `get_spaces` - Get list of available Confluence spaces
- `get_page_comments` - Get comments for a specific page
- `create_page` - Create a new Confluence page
- `update_page` - Update an existing Confluence page
- `create_task_page` - Create a dedicated task/todo page with structured format

### Key Dependencies
- `@modelcontextprotocol/sdk` - MCP SDK for building servers
- `node-fetch` - HTTP client for API calls
- `vitest` - Testing framework (dev dependency)
- `@vitest/coverage-v8` - Coverage reporter (dev dependency)
- Node.js >= 18.0.0 required

## Testing

The project includes comprehensive test suites for both servers using Vitest:

- **Test Files**: Located in `src/__tests__/`
  - `jira_server.test.js` - Tests for Jira MCP server functionality
  - `confluence_server.test.js` - Tests for Confluence MCP server functionality

- **Test Coverage**: Tests include:
  - Server initialization and configuration
  - Authentication and API communication
  - All tool handlers and their error cases
  - Task priority calculation algorithms
  - HTML/text processing utilities
  - API fallback mechanisms (v2 to v1)
  - Integration tests for complete workflows

## Advanced Features

### Jira Server
- **Task Priority Calculation**: Automatically calculates task priority based on:
  - Issue priority level (Highest, High, Medium, Low, Lowest)
  - Due dates and overdue status
  - Issue type (Bug, Story, Task)
- **Smart Sorting**: Tasks are sorted by calculated priority for better productivity
- **Comprehensive Issue Details**: Includes components, labels, fix versions, and comments
- **Comprehensive Logging System**: 
  - Structured JSON logging with timestamp, level, and metadata
  - Three log levels: DEBUG, WARNING, ERROR (configurable via LOG_LEVEL env var)
  - Automatic sensitive data masking (API tokens, passwords)
  - Request/response logging with truncation for large payloads
  - Daily log file rotation (logs/jira-server-YYYY-MM-DD.log)
  - Non-blocking async writes for performance

### Confluence Server
- **Task Extraction**: Automatically extracts tasks and action items from page content using pattern matching for:
  - Checkbox formats (`- [ ] Task`)
  - TODO markers (`TODO: Task`)
  - ACTION items (`ACTION: Task`)
  - @mention assignments (`@user to do something`)
  - Structured sections (Action Items, Next Steps, etc.)
- **API Compatibility**: Supports both Confluence v1 and v2 APIs with automatic fallback
- **Content Processing**: Advanced HTML stripping and text processing utilities
- **Task Page Creation**: Creates structured task pages with priority grouping and summary tables
- **Security**: Includes HTML escaping to prevent XSS in generated content