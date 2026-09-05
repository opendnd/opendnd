import { type FormEvent, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { useApp, useSession } from '../app/context';
import { Notice } from '../components/Notice';
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
        <CardContent>
          {config.auth.mode === 'dev' && (
            <form onSubmit={submitDev}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="dev-name">Your name</FieldLabel>
                  <Input
                    id="dev-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                  />
                  <FieldDescription>
                    Development sign-in. The API must be running with{' '}
                    <code>OPENDND_DEV_AUTH=on</code>; it trusts the name you
                    give.
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
