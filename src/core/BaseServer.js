import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ErrorHandler } from './ErrorHandler.js';
import { ResponseFormatter } from './ResponseFormatter.js';

/**
 * Abstract base class for MCP servers
 * Provides common functionality for all MCP server implementations
 */
export class BaseServer {
  constructor(config, toolRegistry) {
    if (new.target === BaseServer) {
      throw new Error('BaseServer is an abstract class and cannot be instantiated directly');
    }
    
    this.config = config;
    this.toolRegistry = toolRegistry;
    this.errorHandler = new ErrorHandler();
    this.responseFormatter = new ResponseFormatter();
    
    this.server = new Server(
      {
        name: config.serverName,
        version: config.serverVersion || '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );
    
    this.setupHandlers();
  }
  
  /**
   * Setup MCP request handlers
   */
  setupHandlers() {
    // List tools handler
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.toolRegistry.getToolDefinitions(),
    }));
    
    // Call tool handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      try {
        const tool = this.toolRegistry.getTool(name);
        if (!tool) {
          throw new Error(`Unknown tool: ${name}`);
        }
        
        // Validate arguments against tool schema
        await this.validateArguments(args, tool.inputSchema);
        
        // Execute tool handler
        const result = await tool.handler(args);
        
        // Format response
        return this.responseFormatter.success(result);
        
      } catch (error) {
        // Handle and format error response
        const formattedError = this.errorHandler.handle(error);
        return this.responseFormatter.error(formattedError);
      }
    });
  }
  
  /**
   * Validate arguments against tool schema
   * @param {Object} args - Arguments to validate
   * @param {Object} schema - JSON schema for validation
   */
  async validateArguments(args, schema) {
    if (!schema) return;
    
    // Check required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in args)) {
          throw new Error(`Missing required parameter: ${field}`);
        }
      }
    }
    
    // Validate field types
    if (schema.properties) {
      for (const [field, fieldSchema] of Object.entries(schema.properties)) {
        if (field in args) {
          const value = args[field];
          const expectedType = fieldSchema.type;
          
          if (expectedType && !this.validateType(value, expectedType)) {
            throw new Error(`Invalid type for ${field}: expected ${expectedType}, got ${typeof value}`);
          }
          
          // Validate enum values
          if (fieldSchema.enum && !fieldSchema.enum.includes(value)) {
            throw new Error(`Invalid value for ${field}: must be one of ${fieldSchema.enum.join(', ')}`);
          }
          
          // Apply default values
          if (value === undefined && 'default' in fieldSchema) {
            args[field] = fieldSchema.default;
          }
        }
      }
    }
  }
  
  /**
   * Validate value type
   * @param {*} value - Value to validate
   * @param {string} expectedType - Expected type
   * @returns {boolean} - True if valid
   */
  validateType(value, expectedType) {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number';
      case 'boolean':
        return typeof value === 'boolean';
      case 'object':
        return typeof value === 'object' && value !== null;
      case 'array':
        return Array.isArray(value);
      default:
        return true;
    }
  }
  
  /**
   * Run the server
   */
  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`${this.config.serverName} running on stdio`);
  }
  
  /**
   * Register a new tool
   * @param {Object} tool - Tool definition
   */
  registerTool(tool) {
    this.toolRegistry.register(tool);
  }
  
  /**
   * Get server instance (for testing)
   * @returns {Server} - MCP server instance
   */
  getServer() {
    return this.server;
  }
}