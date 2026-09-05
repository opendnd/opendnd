import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useApp } from '../app/context';
import { Loading, Notice } from '../components/Notice';
import { Button } from '@/components/ui/button';

/** Where the hosted sign-in sends the browser back to. */
export function Callback() {
  const { cognito, sessions } = useApp();
  const navigate = useNavigate();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!cognito) {
      setError('Sign-in is not configured for this build.');
      return;
    }
    cognito
      .complete(window.location.href)
      .then(({ session, returnTo }) => {
        sessions.write(session);
        void navigate(returnTo, { replace: true });
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
  }, [cognito, sessions, navigate]);

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        {error ? (
          <Notice
            tone="error"
            title="Sign-in did not complete"
            action={
              <Button
                variant="outline"
                size="xs"
                render={<Link to="/sign-in" />}
              >
                Try again
              </Button>
            }
          >
            {error}
          </Notice>
        ) : (
          <Loading label="Signing you in…" />
        )}
      </div>
    </div>
  );
}
