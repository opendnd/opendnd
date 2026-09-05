import { type FormEvent, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { useApp, useSession, useSignOutReason } from '../app/context';
import type { SignOutReason } from '../auth/session';
import { Notice } from '../components/Notice';
import type { AuthConfig } from '../config';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

export function SignIn() {
  const { config, signInDev, beginSignIn } = useApp();
  const session = useSession();
  const reason = useSignOutReason();
  const [params] = useSearchParams();
  const returnTo = params.get('returnTo') ?? '/worlds';
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (session) return <Navigate to={returnTo} replace />;

  const submitDev = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) signInDev(name);
  };

  const startCognito = async () => {
    setBusy(true);
    try {
      await beginSignIn(returnTo);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">OpenDnD</CardTitle>
          <CardDescription>Sign in to open your worlds.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {reason && <SignedOut reason={reason} auth={config.auth} />}

          {config.auth.mode === 'dev' && (
            <form onSubmit={submitDev}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="dev-name">Any name</FieldLabel>
                  <Input
                    id="dev-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                  />
                  <FieldDescription>
                    Development sign-in: the name becomes your account on the
                    local API, which trusts it. The API has to run with
                    development sign-in on, which <code>bunx projen dev</code>{' '}
                    in <code>apps/@opendnd/api</code> does.
                  </FieldDescription>
                </Field>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={!name.trim()}
                >
                  Sign in
                </Button>
              </FieldGroup>
            </form>
          )}

          {config.auth.mode === 'cognito' && (
            <div className="flex flex-col gap-3">
              <Button
                type="button"
                className="w-full"
                disabled={busy}
                onClick={startCognito}
              >
                {busy && <Spinner data-icon="inline-start" />}
                {busy ? 'Redirecting…' : 'Sign in or create an account'}
              </Button>
              {error && <Notice tone="error">{error}</Notice>}
            </div>
          )}

          {config.auth.mode === 'none' && (
            <Notice tone="warning" title="Sign-in is not available">
              {config.auth.reason}
            </Notice>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Why the last session ended, so nobody is returned here unexplained. */
function SignedOut(props: {
  readonly reason: SignOutReason;
  readonly auth: AuthConfig;
}) {
  if (props.reason === 'expired') {
    return (
      <Notice tone="warning" title="Your session expired">
        Sign in again to carry on.
      </Notice>
    );
  }
  if (props.auth.mode === 'dev') {
    return (
      <Notice tone="warning" title="The API refused the sign-in">
        It answered 401 to the development token, which means it is running
        without development sign-in. Start it with <code>bunx projen dev</code>{' '}
        in <code>apps/@opendnd/api</code>, or set{' '}
        <code>OPENDND_DEV_AUTH=on</code> when starting it another way, then sign
        in again.
      </Notice>
    );
  }
  return (
    <Notice tone="warning" title="Your session was refused">
      The API no longer accepts it. Sign in again.
    </Notice>
  );
}
