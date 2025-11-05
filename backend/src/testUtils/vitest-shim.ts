type Hook = () => void | Promise<void>;
type TestFn = () => void | Promise<void>;

type MockImplementation = (...args: any[]) => any;

type MockFn = ((...args: any[]) => any) & {
  calls: any[][];
  mockImplementation(fn: MockImplementation): MockFn;
  mockResolvedValue(value: any): MockFn;
  mockRejectedValue(error: any): MockFn;
  mockReturnValue(value: any): MockFn;
  mockReset(): void;
};

type Suite = {
  name: string;
  beforeAll: Hook[];
  beforeEach: Hook[];
  afterAll: Hook[];
  tests: Array<{ name: string; fn: TestFn }>;
};

const suiteStack: Suite[] = [];
const suites: Suite[] = [];

function createSuite(name: string): Suite {
  return { name, beforeAll: [], beforeEach: [], afterAll: [], tests: [] };
}

export function describe(name: string, fn: () => void) {
  const suite = createSuite(name);
  suiteStack.push(suite);
  try {
    fn();
  } finally {
    suiteStack.pop();
  }
  suites.push(suite);
}

function currentSuite(): Suite {
  const suite = suiteStack[suiteStack.length - 1];
  if (!suite) {
    throw new Error("No active test suite. Wrap tests in describe().");
  }
  return suite;
}

export function beforeAll(fn: Hook) {
  currentSuite().beforeAll.push(fn);
}

export function beforeEach(fn: Hook) {
  currentSuite().beforeEach.push(fn);
}

export function afterAll(fn: Hook) {
  currentSuite().afterAll.push(fn);
}

export function test(name: string, fn: TestFn) {
  currentSuite().tests.push({ name, fn });
}

export const it = test;

function createMock(): MockFn {
  const mock: Partial<MockFn> = (
    (...args: any[]) => {
      mock.calls!.push(args);
      if (mock.impl) {
        return mock.impl(...args);
      }
      return mock.returnValue;
    }
  ) as MockFn;

  mock.calls = [];
  mock.mockImplementation = (fn: MockImplementation) => {
    mock.impl = fn;
    return mock;
  };
  mock.mockResolvedValue = (value: any) => {
    mock.impl = () => Promise.resolve(value);
    return mock;
  };
  mock.mockRejectedValue = (error: any) => {
    mock.impl = () => Promise.reject(error);
    return mock;
  };
  mock.mockReturnValue = (value: any) => {
    mock.returnValue = value;
    return mock;
  };
  mock.mockReset = () => {
    mock.calls = [];
    delete mock.impl;
    delete mock.returnValue;
  };

  return mock;
}

export const vi = {
  fn: createMock,
};

function format(value: any) {
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

export function expect(actual: any) {
  return {
    toBe(expected: any) {
      if (actual !== expected) {
        throw new Error(`Expected ${format(actual)} to be ${format(expected)}`);
      }
    },
    toBeGreaterThan(expected: number) {
      if (!(actual > expected)) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`);
      }
    },
    toBeGreaterThanOrEqual(expected: number) {
      if (!(actual >= expected)) {
        throw new Error(`Expected ${actual} to be >= ${expected}`);
      }
    },
    toHaveBeenCalledTimes(expected: number) {
      const calls = Array.isArray(actual?.calls) ? actual.calls.length : 0;
      if (calls !== expected) {
        throw new Error(`Expected mock to be called ${expected} times but was ${calls}`);
      }
    },
    toBeTruthy() {
      if (!actual) {
        throw new Error(`Expected value to be truthy but was ${format(actual)}`);
      }
    },
  };
}

async function runHook(hook: Hook) {
  await Promise.resolve(hook());
}

async function runTest(fn: TestFn) {
  await Promise.resolve(fn());
}

export async function runSuites() {
  let failures = 0;

  for (const suite of suites) {
    console.log(`Suite: ${suite.name}`);
    try {
      for (const hook of suite.beforeAll) {
        await runHook(hook);
      }

      for (const testCase of suite.tests) {
        for (const hook of suite.beforeEach) {
          await runHook(hook);
        }

        try {
          await runTest(testCase.fn);
          console.log(`  ✓ ${testCase.name}`);
        } catch (err) {
          failures += 1;
          console.error(`  ✗ ${testCase.name}: ${String(err instanceof Error ? err.message : err)}`);
        }
      }

      for (const hook of suite.afterAll) {
        await runHook(hook);
      }
    } catch (err) {
      failures += 1;
      console.error(`  ✗ Suite failed: ${String(err instanceof Error ? err.message : err)}`);
    }
  }

  suites.length = 0;

  if (failures > 0) {
    throw new Error(`${failures} test(s) failed`);
  }
}
