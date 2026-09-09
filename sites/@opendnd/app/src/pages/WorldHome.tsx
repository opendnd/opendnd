import { Page } from '../build/Page';
import { PAGES } from '../build/pages';

/**
 * Inside a world: a question first, then the numbers, the campaigns, and what
 * changed last.
 *
 * Four blocks on the grid rather than four sections of a page, so that a
 * world can put its own front page together out of them — or out of others.
 */
export function WorldHome() {
  return (
    <div className="mx-auto w-full max-w-5xl">
      <Page page={PAGES.home} />
    </div>
  );
}
