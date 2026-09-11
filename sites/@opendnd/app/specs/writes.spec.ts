import { models } from '@opendnd/types';
import { describe, expect, it } from 'vitest';
import { BUNDLED, copyOf, builtIn, projectFor } from 'src/build/project';
import { RECORD_PAGES } from 'src/build/pages';

/**
 * What the application writes has to be a shape the ontology accepts.
 *
 * The application is built from what the API describes at run time and
 * knows no model at build time, which is what makes it general. The cost is
 * that nothing stops it writing a record the API will refuse — and twice now
 * it has: a page of blocks went out under `pages`/`blocks` after the
 * ontology had moved to `page`/`block`, and the specs did not catch it
 * because they asserted the same wrong shape the code produced.
 *
 * So these parse against the generated schemas rather than against a
 * fixture. A rename in the ontology fails here, in the place that has to
 * change, instead of in a request nobody makes until a person clicks the
 * button.
 */

/** The platform fills these in; a client neither sends nor invents them. */
const stamped = (body: Record<string, unknown>) => ({
  id: '3c2d3b40-9f0a-4d3e-8f6d-8c0b2c8e1a11',
  world: '3c2d3b40-9f0a-4d3e-8f6d-8c0b2c8e1a12',
  canonStatus: 'proposed',
  meta: { versionId: '1', lastUpdated: '2026-09-10T00:00:00.000Z' },
  ...body,
});

const parse = (body: Record<string, unknown>) =>
  models.project.safeParse(stamped(body));

function whyNot(result: ReturnType<typeof parse>): string {
  return result.success
    ? ''
    : result.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
}

describe('the records the application writes', () => {
  it('makes a project the ontology accepts when a page is customized', () => {
    for (const page of builtIn().pages) {
      const result = parse(copyOf(page, 'A world'));
      expect(whyNot(result), `copying ${page.path}`).toBe('');
    }
  });

  it('makes one the ontology accepts for a record page too', () => {
    for (const [model, page] of Object.entries(RECORD_PAGES)) {
      const result = parse(
        copyOf(
          {
            id: model,
            name: model,
            path: model,
            scope: 'record',
            layout: { rows: 'fit', blocks: [...page.blocks] },
          },
          'A world',
        ),
      );
      expect(whyNot(result), `record page for ${model}`).toBe('');
    }
  });

  it('ships bundled applications the ontology accepts', () => {
    for (const app of BUNDLED) {
      const project = projectFor(app);
      const result = parse({
        name: project.name,
        status: project.status,
        page: project.pages.map((one) => ({
          id: one.id,
          name: one.name,
          path: one.path,
          scope: one.scope,
          rows: one.layout.rows,
          block: one.layout.blocks.map((placed) => ({ ...placed })),
        })),
      });
      expect(whyNot(result), app.id).toBe('');
    }
  });
});
