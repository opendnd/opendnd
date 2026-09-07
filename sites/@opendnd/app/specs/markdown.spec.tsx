import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Article } from 'src/components/Article';
import { describe as describeSchema } from 'src/schema/fields';
import { petOntology, storedPet } from './fixtures/ontology';
import { renderInWorld } from './helpers';

const ontology = petOntology();
const root = describeSchema(ontology.schema('pet')!, ontology, { name: 'pet' });

describe('prose on a record', () => {
  it('is Markdown, with links to the web kept and links to nowhere left as words', () => {
    renderInWorld(
      <Article
        resource={{
          ...storedPet,
          description:
            '## The dog\n\nBiscuit is **small**. See [the kennel](https://example.test/kennel) and [the vet](vet).\n\n![a picture](uploads/biscuit.png)',
        }}
        root={root}
      />,
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'The dog' }),
    ).toBeInTheDocument();
    expect(screen.getByText('small').tagName).toBe('STRONG');
    expect(screen.getByRole('link', { name: 'the kennel' })).toHaveAttribute(
      'target',
      '_blank',
    );
    expect(
      screen.queryByRole('link', { name: 'the vet' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('the vet')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
