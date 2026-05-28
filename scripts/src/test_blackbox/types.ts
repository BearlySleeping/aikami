// scripts/src/test_blackbox/types.ts
// Shared types for the blackbox test framework.

export type SuiteResult = {
  name: string;
  status: 'pass' | 'fail' | 'skipped';
  duration: number;
  error?: string;
};

export type TestSuite = {
  name: string;
  category: 'validation' | 'service' | 'cross-service';
  run: () => Promise<void>;
};

export type TestSuites = TestSuite[];

export type BlackboxReport = {
  timestamp: string;
  duration: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  suites: SuiteResult[];
};
