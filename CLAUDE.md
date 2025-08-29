# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- `npm start:jira` - Start the Jira MCP server
- `npm start:confluence` - Start the Confluence MCP server  
- `npm dev:jira` - Start Jira server with Node.js debugger enabled
- `npm dev:confluence` - Start Confluence server with Node.js debugger enabled

### Testing
- No test command configured yet (vitest is installed as a devDependency)

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

### Environment Variables Required

#### Jira Server
- `JIRA_URL` - Your Jira instance URL (e.g., https://yourcompany.atlassian.net)
- `JIRA_EMAIL` - Your Atlassian account email
- `JIRA_API_TOKEN` - Jira API token for authentication

#### Confluence Server  
- `CONFLUENCE_URL` - Your Confluence instance URL (e.g., https://yourcompany.atlassian.net/wiki)
- `CONFLUENCE_EMAIL` - Your Atlassian account email
- `CONFLUENCE_API_TOKEN` - Confluence API token for authentication

### Key Dependencies
- `@modelcontextprotocol/sdk` - MCP SDK for building servers
- `node-fetch` - HTTP client for API calls
- Node.js >= 18.0.0 required