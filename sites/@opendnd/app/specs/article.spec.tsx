import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Article } from 'src/components/Article';
import { describe as describeSchema } from 'src/schema/fields';
import {
  FRIEND_ID,
  OWNER_ID,
  WORLD_ID,
  petOntology,
  storedPet,
} from './fixtures/ontology';
import { renderInWorld } from './helpers';

const ontology = petOntology();
const root = describeSchema(ontology.schema('pet')!, ontology, { name: 'pet' });

describe('a resource as an article', () => {
  it('leads with the name, what it is, and its description in paragraphs', () => {
    renderInWorld(<Article resource={storedPet} root={root} />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Biscuit');
    const header = within(heading.closest('header')!);
    for (const badge of ['Pet', 'Canon', 'In universe', 'Revision 2']) {
      expect(header.getByText(badge)).toBeInTheDocument();
    }
    expect(screen.getByText('A small dog.')).toBeInTheDocument();
    expect(screen.getByText('Fond of shoes.')).toBeInTheDocument();
  });

  it('says when a record came from a module, and stays quiet when it did not', () => {
    const digest = `sha256:${'c'.repeat(64)}`;
    const { unmount } = renderInWorld(
      <Article resource={{ ...storedPet, module: digest }} root={root} />,
    );
    expect(screen.getByText('From a module')).toHaveAttribute('title', digest);
    unmount();
    renderInWorld(<Article resource={storedPet} root={root} />);
    expect(screen.queryByText('From a module')).not.toBeInTheDocument();
  });

  it('shows codes by their display text and references as links', () => {
    renderInWorld(<Article resource={storedPet} root={root} />);
    expect(screen.getByText('Mood').nextElementSibling).toHaveTextContent(
      'Happy',
    );
    expect(screen.getByRole('link', { name: 'Ada' })).toHaveAttribute(
      'href',
      `/worlds/${WORLD_ID}/person/${OWNER_ID}`,
    );
    expect(screen.getByRole('link', { name: 'Crumb' })).toHaveAttribute(
      'href',
      `/worlds/${WORLD_ID}/pet/${FRIEND_ID}`,
    );
  });

  it('renders lists, nested objects, booleans and unknown shapes', () => {
    renderInWorld(<Article resource={storedPet} root={root} />);
    expect(screen.getByText('roll over')).toBeInTheDocument();
    expect(screen.getByText('Friendly').nextElementSibling).toHaveTextContent(
      'Yes',
    );
    expect(screen.getByText('Born').nextElementSibling).toHaveTextContent(
      'Year1041',
    );
    // A field the schema does not name is still shown, as JSON.
    expect(
      screen.getByText('Unknown field').nextElementSibling?.textContent,
    ).toContain('"deep"');
    expect(
      screen.getByText('Extras').nextElementSibling?.textContent,
    ).toContain('"collar"');
  });

  it('leaves out what is empty and what the header already said', () => {
    renderInWorld(<Article resource={storedPet} root={root} />);
    expect(screen.queryByText('Weight')).not.toBeInTheDocument();
    expect(screen.queryByText('Seen')).not.toBeInTheDocument();
    expect(screen.queryByText('Recorded')).not.toBeInTheDocument();
    expect(screen.queryByText('World')).not.toBeInTheDocument();
  });
});
