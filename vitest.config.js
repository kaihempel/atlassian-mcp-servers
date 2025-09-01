import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',
    
    // Global test timeout
    testTimeout: 10000,
    
    // Hook timeout
    hookTimeout: 10000,
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'src/**/*.test.js',
        'src/**/*.spec.js',
        '**/*.config.js',
        '**/dist/**'
      ],
      include: [
        'src/confluence_server.js',
        'src/jira_server.js'
      ],
      all: true,
      lines: 80,
      functions: 80,
      branches: 80,
      statements: 80
    },
    
    // Mock configuration
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    
    // Reporter configuration
    reporters: ['verbose'],
    
    // Watch configuration
    watchExclude: ['**/node_modules/**', '**/dist/**'],
    
    // Global setup
    globals: true,
    
    // Isolation
    isolate: true,
    
    // Threading
    threads: true,
    
    // Silent mode for CI
    silent: process.env.CI === 'true'
  }
});