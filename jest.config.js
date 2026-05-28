/** @type {import('jest').Config} */
module.exports = {
  projects: [
    '<rootDir>/packages/shared/jest.config.js',
    '<rootDir>/packages/backend/jest.config.js',
    '<rootDir>/packages/worker/jest.config.js',
  ],
  coverageDirectory: '<rootDir>/coverage',
  collectCoverageFrom: [
    'packages/*/src/**/*.{ts,tsx}',
    '!packages/*/src/**/index.ts',
    '!packages/frontend/**',
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 75,
      lines: 80,
      statements: 80,
    },
  },
};
