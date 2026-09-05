/** Who is signed in, and what to send the API to prove it. */
export interface Session {
  readonly mode: 'dev' | 'cognito';
  readonly subject: string;
  readonly name?: string;
  readonly email?: string;
  /** Sent as `Authorization: Bearer <token>`. */
  readonly token: string;
  /** Milliseconds since the epoch, absent for a token that does not expire. */
  readonly expiresAt?: number;
  readonly refreshToken?: string;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY = 'opendnd.session';

/**
 * The session in browser storage, so a reload does not sign the user out.
 *
 * Storage may be unavailable or refuse writes (private windows, blocked site
 * data), so every access is guarded and the store behaves as empty then.
 */
/** Why a session ended without the user asking, for the sign-in page to say. */
export type SignOutReason = 'unauthorized' | 'expired';

export class SessionStore {
  private readonly listeners = new Set<() => void>();
  private cached: Session | undefined | null = null;
  private lastReason: SignOutReason | undefined;

  constructor(private readonly storage: KeyValueStorage | undefined) {}

  read(): Session | undefined {
    if (this.cached !== null) return this.cached;
    try {
      const raw = this.storage?.getItem(KEY);
      this.cached = raw ? (JSON.parse(raw) as Session) : undefined;
    } catch {
      this.cached = undefined;
    }
    return this.cached;
  }

  write(session: Session): void {
    this.cached = session;
    this.lastReason = undefined;
    try {
      this.storage?.setItem(KEY, JSON.stringify(session));
    } catch {
      // Kept in memory for this page only.
    }
    this.notify();
  }

  /**
   * Ends the session. A reason means it was not the user's own doing: the
   * API refused the token, or it expired and could not be refreshed. The
   * sign-in page reads it back so nobody is returned to the form unexplained.
   */
  clear(reason?: SignOutReason): void {
    this.cached = undefined;
    this.lastReason = reason;
    try {
      this.storage?.removeItem(KEY);
    } catch {
      // Nothing to remove.
    }
    this.notify();
  }

  /** Why the last session ended, until the next one begins. */
  reason(): SignOutReason | undefined {
    return this.lastReason;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/** A session for the development resolver, which trusts the name given. */
export function devSession(name: string): Session {
  const subject = name.trim();
  return { mode: 'dev', subject, name: subject, token: `dev:${subject}` };
}

/** Whether a session's token is within `withinMs` of expiring, or past it. */
export function expiresSoon(session: Session, now: number, withinMs = 60_000) {
  return session.expiresAt !== undefined && session.expiresAt - withinMs <= now;
}
