type Hook = () => void | Promise<void>;
type TestFn = () => void | Promise<void>;

type MockImplementation = (...args: any[]) => any;

type MockFn = ((...args: any[]) => any) & {
  calls: any[][];
  mockImplementation(fn: MockImplementation): MockFn;
  mockImplementationOnce(fn: MockImplementation): MockFn;
  mockResolvedValue(value: any): MockFn;
  mockResolvedValueOnce(value: any): MockFn;
  mockReturnValue(value: any): MockFn;
  mockReset(): void;
};

type Suite = {
  name: string;
  beforeAll: Hook[];
  beforeEach: Hook[];
  afterEach: Hook[];
  afterAll: Hook[];
  tests: Array<{ name: string; fn: TestFn; afterEachGroups: Hook[][] }>;
};

const suiteStack: Suite[] = [];
const suites: Suite[] = [];

function createSuite(name: string): Suite {
  return { name, beforeAll: [], beforeEach: [], afterEach: [], afterAll: [], tests: [] };
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

export function afterEach(fn: Hook) {
  currentSuite().afterEach.push(fn);
}

export function afterAll(fn: Hook) {
  currentSuite().afterAll.push(fn);
}

export function test(name: string, fn: TestFn) {
  const suite = currentSuite();
  const afterEachGroups = suiteStack.map((ctx) => ctx.afterEach);
  suite.tests.push({ name, fn, afterEachGroups });
}

export const it = test;

function createMock(): MockFn {
  const implementations: MockImplementation[] = [];
  const mock: Partial<MockFn> = ((...args: any[]) => {
    mock.calls!.push(args);
    const impl = implementations.shift() ?? mock.impl ?? mock.returnValueImpl;
    if (impl) {
      return impl(...args);
    }
    return undefined;
  }) as MockFn;

  mock.calls = [];
  mock.mockImplementation = (fn: MockImplementation) => {
    mock.impl = fn;
    return mock;
  };
  mock.mockImplementationOnce = (fn: MockImplementation) => {
    implementations.push(fn);
    return mock;
  };
  mock.mockResolvedValue = (value: any) => {
    mock.impl = () => Promise.resolve(value);
    return mock;
  };
  mock.mockResolvedValueOnce = (value: any) => {
    implementations.push(() => Promise.resolve(value));
    return mock;
  };
  mock.mockReturnValue = (value: any) => {
    mock.returnValueImpl = () => value;
    return mock;
  };
  mock.mockReset = () => {
    mock.calls = [];
    delete mock.impl;
    delete mock.returnValueImpl;
    implementations.length = 0;
  };

  return mock;
}

let moduleVersion = 0;

export const vi = {
  fn: createMock,
  resetModules() {
    moduleVersion += 1;
  },
  get moduleVersion() {
    return moduleVersion;
  },
};

function format(value: any) {
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function isObject(value: any): value is Record<string, any> {
  return value !== null && typeof value === "object";
}

export function expect(actual: any) {
  return {
    toBe(expected: any) {
      if (actual !== expected) {
        throw new Error(`Expected ${format(actual)} to be ${format(expected)}`);
      }
    },
    toEqual(expected: any) {
      const actualJson = JSON.stringify(actual);
      const expectedJson = JSON.stringify(expected);
      if (actualJson !== expectedJson) {
        throw new Error(`Expected ${actualJson} to equal ${expectedJson}`);
      }
    },
    toContain(expected: any) {
      if (typeof actual === "string") {
        if (!actual.includes(expected)) {
          throw new Error(`Expected string ${format(actual)} to contain ${format(expected)}`);
        }
        return;
      }
      if (Array.isArray(actual)) {
        if (!actual.includes(expected)) {
          throw new Error(`Expected array to contain ${format(expected)}`);
        }
        return;
      }
      throw new Error("toContain requires string or array");
    },
    toBeTruthy() {
      if (!actual) {
        throw new Error(`Expected value to be truthy but was ${format(actual)}`);
      }
    },
    toBeFalsy() {
      if (actual) {
        throw new Error(`Expected value to be falsy but was ${format(actual)}`);
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

async function runAfterEachGroups(groups: Hook[][]) {
  for (const group of [...groups].reverse()) {
    for (const hook of [...group].reverse()) {
      await runHook(hook);
    }
  }
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
          await runAfterEachGroups(testCase.afterEachGroups);
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
