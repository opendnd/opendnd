import { CircleAlertIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Problem } from '../api/client';
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

export type Tone = 'info' | 'error' | 'warning';

const ICONS = {
  info: InfoIcon,
  error: CircleAlertIcon,
  warning: TriangleAlertIcon,
} as const;

/** A message with a tone: information, a warning, or an error. */
export function Notice(props: {
  readonly tone?: Tone;
  readonly title?: string;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
}) {
  const tone = props.tone ?? 'info';
  const Icon = ICONS[tone];
  return (
    <Alert
      variant={tone === 'error' ? 'destructive' : 'default'}
      className={
        tone === 'warning' ? 'text-amber-900 dark:text-amber-200' : undefined
      }
    >
      <Icon />
      {props.title && <AlertTitle>{props.title}</AlertTitle>}
      {props.children && <AlertDescription>{props.children}</AlertDescription>}
      {props.action && <AlertAction>{props.action}</AlertAction>}
    </Alert>
  );
}

/** A spinner with a word, for anything still on its way. */
export function Loading(props: { readonly label?: string }) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 py-2 text-sm text-muted-foreground"
    >
      <Spinner />
      <span>{props.label ?? 'Loading…'}</span>
    </div>
  );
}

/** An error as the API described it, with its request id for a bug report. */
export function ErrorNotice(props: {
  readonly error: Error;
  readonly onRetry?: () => void;
}) {
  const { error } = props;
  const problem = error instanceof Problem ? error : undefined;
  return (
    <Notice
      tone="error"
      title={problem ? titleFor(problem) : 'Something went wrong'}
      action={
        props.onRetry && (
          <Button variant="outline" size="xs" onClick={props.onRetry}>
            Try again
          </Button>
        )
      }
    >
      <p>{error.message}</p>
      {problem?.issues !== undefined && <Issues issues={problem.issues} />}
      {problem?.requestId && (
        <p className="text-xs opacity-70">Request {problem.requestId}</p>
      )}
    </Notice>
  );
}

function titleFor(problem: Problem): string {
  switch (problem.code) {
    case 'validation':
      return 'The API refused this';
    case 'not-found':
      return 'Not found';
    case 'forbidden':
      return 'Not allowed';
    case 'unauthorized':
      return 'Sign in again';
    case 'stale':
      return 'Someone else changed this first';
    case 'conflict':
      return 'That already exists';
    case 'network':
      return 'The API is unreachable';
    default:
      return 'The API reported a problem';
  }
}

/** Validation issues, whatever shape the API gave them, one line each. */
export function Issues(props: { readonly issues: unknown }) {
  const lines = Array.isArray(props.issues)
    ? props.issues.map(describeIssue)
    : [JSON.stringify(props.issues)];
  return (
    <ul className="list-disc pl-5">
      {lines.map((line, index) => (
        <li key={index}>{line}</li>
      ))}
    </ul>
  );
}

function describeIssue(issue: unknown): string {
  if (typeof issue !== 'object' || issue === null) return String(issue);
  const { path, message } = issue as { path?: unknown[]; message?: string };
  const where =
    Array.isArray(path) && path.length > 0 ? `${path.join('.')}: ` : '';
  return `${where}${message ?? JSON.stringify(issue)}`;
}
