import { CircleAlertIcon } from 'lucide-react';
import { Link, isRouteErrorResponse, useRouteError } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';

/** The page for an error the router caught: a bad address or a render failure. */
export function ErrorPage() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? error.status === 404
      ? 'There is nothing at this address.'
      : `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Something went wrong.';
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Empty className="max-w-md border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CircleAlertIcon />
          </EmptyMedia>
          <EmptyTitle>This page could not be shown</EmptyTitle>
          <EmptyDescription>{message}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" render={<Link to="/worlds" />}>
            Your worlds
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}
