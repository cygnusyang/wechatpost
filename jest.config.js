module.exports = {
  preset: 'ts-jest/presets/js-with-ts',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/src/test'],
  testMatch: [
    '<rootDir>/src/test/unit/**/*.test.ts',
    '<rootDir>/src/test/unit/**/*.test.js',
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
    }],
  },
  // Mock all external dependencies that need it
  moduleNameMapper: {
    '^vscode$': '<rootDir>/src/test/__mocks__/vscode.ts',
    '^node-fetch$': '<rootDir>/src/test/__mocks__/node-fetch.ts',
    '^form-data$': '<rootDir>/src/test/__mocks__/form-data.ts',
    '^jsdom$': '<rootDir>/src/test/__mocks__/jsdom.ts',
    '^mermaid$': '<rootDir>/src/test/__mocks__/mermaid.ts',
    '^src/(.*)$': '<rootDir>/src/$1',
  },
  // Only ignore node_modules that don't need transpilation - all the remark/unified ecosystem is ESM
  transformIgnorePatterns: [
    'node_modules/(?!(node-fetch|form-data|jsdom|mermaid|unified|devlop|bail|is-plain-obj|trough|remark-parse|remark-gfm|remark-rehype|rehype-highlight|rehype-stringify|rehype-parse|unist-util-visit|unist-util-stringify-position|unist-util-is|unist-util-position-from-estree|mdast-util-from-markdown|mdast-util-to-hast|micromark-util-combine-extensions|micromark-util-types|micromark-util-symbol)/)',
  ],
  coverageReporters: ['text', 'lcov', 'json-summary'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/test/**/*.ts',
    '!src/**/*.test.ts',
    '!webview-src/**/*.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
