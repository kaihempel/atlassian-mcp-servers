# Atlassian MCP Servers

Model Context Protocol (MCP) servers for integrating with Atlassian products - Jira and Confluence.

## Overview

This repository provides two MCP servers that enable seamless integration with Atlassian services:

- **Jira MCP Server**: Query issues, manage tasks, and retrieve project data from Jira
- **Confluence MCP Server**: Search pages, extract tasks, create/update content, and manage spaces in Confluence

## Quick Start

### Prerequisites

- Node.js >= 18.0.0
- Atlassian account with API access
- API tokens for Jira and/or Confluence

### Installation

```bash
npm install
```

### Environment Setup

Create environment variables for the services you want to use:

#### For Jira
```bash
export JIRA_URL=https://yourcompany.atlassian.net
export JIRA_EMAIL=your-email@company.com
export JIRA_API_TOKEN=your-jira-api-token
export LOG_LEVEL=DEBUG  # Optional: DEBUG, WARNING, or ERROR (default: DEBUG)
```

#### For Confluence
```bash
export CONFLUENCE_URL=https://yourcompany.atlassian.net/wiki
export CONFLUENCE_EMAIL=your-email@company.com
export CONFLUENCE_API_TOKEN=your-confluence-api-token
```

### Running the Servers

```bash
# Start Jira MCP server
npm run start:jira

# Start Confluence MCP server
npm run start:confluence

# For development with debugging
npm run dev:jira
npm run dev:confluence
```

## Features

### Jira Integration
- **Issue Management**: Search, filter, and retrieve detailed issue information
- **Task Organization**: Get assigned tasks with intelligent priority calculation
- **Project Tracking**: Monitor project progress and recent activities
- **Smart Prioritization**: Automatically sort tasks by urgency, due dates, and issue types
- **Advanced Logging**: Structured JSON logs with configurable levels, automatic sensitive data masking, and daily rotation

### Confluence Integration
- **Content Discovery**: Search pages across spaces with flexible queries
- **Task Extraction**: Automatically identify and extract tasks from meeting notes and documentation
- **Content Creation**: Create and update pages with rich formatting
- **Collaboration**: Access comments and track page modifications
- **Task Management**: Generate structured task pages with priority grouping

## Available Tools

### Jira Tools
- `get_assigned_issues` - Retrieve your assigned issues with filtering
- `search_issues` - Perform JQL-based issue searches
- `get_issue_details` - Get comprehensive issue information
- `get_recent_issues` - Track recently updated issues
- `get_my_tasks` - Get prioritized task list with due dates
- `get_project_issues` - Monitor specific project activities

### Confluence Tools
- `search_pages` - Search content across Confluence spaces
- `get_page_content` - Retrieve full page content
- `get_recent_pages` - Track recently modified pages
- `get_my_pages` - Find your authored pages
- `get_page_tasks` - Extract actionable items from pages
- `get_spaces` - List available Confluence spaces
- `get_page_comments` - Access page discussions
- `create_page` - Create new pages with rich content
- `update_page` - Modify existing pages
- `create_task_page` - Generate structured task tracking pages

## Logging

The Jira server includes a comprehensive logging system that helps with debugging and monitoring:

### Features
- **Structured JSON Logging**: All logs are written in JSON format for easy parsing
- **Configurable Log Levels**: Set `LOG_LEVEL` environment variable to `DEBUG`, `WARNING`, or `ERROR`
- **Automatic Sensitive Data Masking**: API tokens, passwords, and authorization headers are automatically masked
- **Daily Log Rotation**: New log files are created daily with format `jira-server-YYYY-MM-DD.log`
- **Performance Optimized**: Asynchronous writes to prevent blocking operations
- **Truncation of Large Payloads**: Automatically truncates large request/response data

### Log Location
Logs are stored in the `logs/` directory with the naming pattern:
- Jira: `logs/jira-server-YYYY-MM-DD.log`

### Configuration
Set the log level via environment variable:
```bash
export LOG_LEVEL=DEBUG    # Most verbose - includes all operations
export LOG_LEVEL=WARNING  # Only warnings and errors
export LOG_LEVEL=ERROR    # Only critical errors
```

## Development

### Testing

Run the comprehensive test suite:

```bash
# Run all tests
npm test

# Run tests with UI
npm run test:ui

# Generate coverage report
npm run test:coverage
```

### Architecture

Both servers are built using the Model Context Protocol SDK and feature:

- **Robust Error Handling**: Comprehensive error management with descriptive messages
- **API Compatibility**: Support for multiple Atlassian API versions with automatic fallback
- **Security**: Input validation and HTML escaping to prevent security issues
- **Performance**: Parallel processing for bulk operations
- **Testing**: Full test coverage with mocked API interactions
- **Comprehensive Logging**: Structured JSON logging with automatic sensitive data masking, configurable log levels, and daily log rotation

## API Token Setup

### Jira API Token
1. Go to [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click "Create API token"
3. Give it a descriptive label
4. Copy the generated token

### Confluence API Token
1. Use the same process as Jira - the tokens work across Atlassian products
2. Ensure your account has appropriate permissions for the Confluence spaces you need to access

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Run the test suite
5. Submit a pull request

## License

MIT License

Copyright (c) 2025 Kai Hempel

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.