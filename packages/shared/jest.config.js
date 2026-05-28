/** @type {import('jest').Config} */
module.exports = {
  displayName: '@shopify-oracle/shared',
  testEnvironment: 'node',

  roots: ['<rootDir>/src', '<rootDir>/tests'],

  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.json',
    }],
  },

  testMatch: [
    '**/__tests__/**/*.ts?(x)',
    '**/?(*.)+(spec|test).ts?(x)',
  ],

  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],

  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/src/$1',
  },

  // Collect coverage from source files (not test files, not barrel files).
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/index.ts',
    '!src/**/*.types.ts',
    '!src/**/*.d.ts',
  ],

  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },

  // Clear mocks between tests for isolation.
  clearMocks: true,
  restoreMocks: true,
};
