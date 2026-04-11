import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PlaywrightService } from 'src/services/PlaywrightService';

const mockLaunchPersistentContext = jest.fn();

jest.mock('playwright', () => ({
  chromium: {
    launchPersistentContext: (...args: unknown[]) => mockLaunchPersistentContext(...args),
  },
}));

describe('PlaywrightService', () => {
  const singletonRelPaths = [
    'SingletonLock',
    'SingletonCookie',
    'SingletonSocket',
    'SingletonSocketLock',
    path.join('Default', 'SingletonLock'),
    path.join('Default', 'SingletonCookie'),
    path.join('Default', 'SingletonSocket'),
    path.join('Default', 'SingletonSocketLock'),
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('recovers from ProcessSingleton lock by cleaning stale lock files and retrying once', async () => {
    const processSingletonError = new Error(
      'browserType.launchPersistentContext: Failed to create a ProcessSingleton for your profile directory.'
    );
    const context = {
      once: jest.fn(),
      pages: jest.fn(() => []),
    };

    mockLaunchPersistentContext
      .mockRejectedValueOnce(processSingletonError)
      .mockResolvedValueOnce(context);
    jest.useFakeTimers();

    const service = new PlaywrightService({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
      name: 'test',
    } as any);
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multipost-playwright-'));
    (service as any).userDataDir = userDataDir;
    const singletonPaths = singletonRelPaths.map((relPath) => path.join(userDataDir, relPath));
    for (const singletonPath of singletonPaths) {
      fs.mkdirSync(path.dirname(singletonPath), { recursive: true });
      fs.writeFileSync(singletonPath, 'lock');
    }

    try {
      const launchPromise = (service as any).launchPersistentContextWithRecovery();
      await jest.advanceTimersByTimeAsync(500);
      const launchedContext = await launchPromise;

      expect(launchedContext).toBe(context);
      expect(mockLaunchPersistentContext).toHaveBeenCalledTimes(2);
      for (const singletonPath of singletonPaths) {
        expect(fs.existsSync(singletonPath)).toBe(false);
      }
    } finally {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  it('does not retry for non-ProcessSingleton launch errors', async () => {
    const launchError = new Error('ECONNREFUSED');
    mockLaunchPersistentContext.mockRejectedValueOnce(launchError);

    const service = new PlaywrightService({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
      name: 'test',
    } as any);
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multipost-playwright-'));
    (service as any).userDataDir = userDataDir;
    const probeLockPath = path.join(userDataDir, 'SingletonLock');
    fs.writeFileSync(probeLockPath, 'lock');

    try {
      await expect((service as any).launchPersistentContextWithRecovery()).rejects.toThrow('ECONNREFUSED');
      expect(mockLaunchPersistentContext).toHaveBeenCalledTimes(1);
      expect(fs.existsSync(probeLockPath)).toBe(true);
    } finally {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
