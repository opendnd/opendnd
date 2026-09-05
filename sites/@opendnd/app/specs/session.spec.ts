import { describe, expect, it, vi } from 'vitest';
import { SessionStore, devSession, expiresSoon } from 'src/auth/session';

describe('the session store', () => {
  it('round-trips through storage and tells listeners', () => {
    const map = new Map<string, string>();
    const store = new SessionStore({
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
    });
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.read()).toBeUndefined();
    store.write(devSession('  ada '));
    expect(store.read()).toEqual({
      mode: 'dev',
      subject: 'ada',
      name: 'ada',
      token: 'dev:ada',
    });
    expect(JSON.parse(map.get('opendnd.session')!).subject).toBe('ada');
    store.clear();
    expect(store.read()).toBeUndefined();
    expect(map.size).toBe(0);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('remembers why a session ended until the next one begins', () => {
    const store = new SessionStore(undefined);
    store.write(devSession('ada'));
    expect(store.reason()).toBeUndefined();
    store.clear('unauthorized');
    expect(store.read()).toBeUndefined();
    expect(store.reason()).toBe('unauthorized');
    store.write(devSession('ada'));
    expect(store.reason()).toBeUndefined();
    // The user signing out is not a reason to explain.
    store.clear();
    expect(store.reason()).toBeUndefined();
  });

  it('works in memory when storage refuses', () => {
    const store = new SessionStore({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(store.read()).toBeUndefined();
    store.write(devSession('ada'));
    expect(store.read()?.subject).toBe('ada');
  });

  it('knows when a token is about to expire', () => {
    const session = { ...devSession('ada'), expiresAt: 1000_000 };
    expect(expiresSoon(session, 900_000)).toBe(false);
    expect(expiresSoon(session, 950_000)).toBe(true);
    expect(expiresSoon(devSession('ada'), 5)).toBe(false);
  });
});
