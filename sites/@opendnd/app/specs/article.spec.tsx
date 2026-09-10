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

/** The box of facts beside the lead. */
function infobox() {
  return within(screen.getByRole('complementary'));
}

describe('a resource as an article', () => {
  it('leads with the name, a line saying what it is, and the description', () => {
    renderInWorld(<Article resource={storedPet} root={root} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Biscuit',
    );
    // What used to be a row of badges is a sentence, the way an encyclopedia
    // says it.
    expect(screen.getByText('A canon pet.')).toBeInTheDocument();
    expect(screen.getByText('A small dog.')).toBeInTheDocument();
    expect(screen.getByText('Fond of shoes.')).toBeInTheDocument();
  });

  it('says when a record is written from outside the world, or came from a module', () => {
    const digest = `sha256:${'c'.repeat(64)}`;
    const { unmount } = renderInWorld(
      <Article
        resource={{
          ...storedPet,
          module: digest,
          perspective: 'out-of-universe',
        }}
        root={root}
      />,
    );
    expect(
      screen.getByText(/Written about the world rather than from inside it/),
    ).toBeInTheDocument();
    expect(screen.getByText(/From a module/)).toBeInTheDocument();
    unmount();
    // Neither is said of an ordinary record: in-universe is the usual case.
    renderInWorld(<Article resource={storedPet} root={root} />);
    expect(screen.queryByText(/From a module/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Written about the world/),
    ).not.toBeInTheDocument();
  });

  it('puts what fits on a line in the box, and says when it was last edited', () => {
    renderInWorld(<Article resource={storedPet} root={root} />);
    const box = infobox();
    expect(box.getByText('Mood').nextElementSibling).toHaveTextContent('Happy');
    expect(box.getByText('Legs').nextElementSibling).toHaveTextContent('4');
    expect(box.getByText('Friendly').nextElementSibling).toHaveTextContent(
      'Yes',
    );
    expect(box.getByText(/Revision 2/)).toBeInTheDocument();
  });

  it('gives what needs room a section of its own, with an anchor', () => {
    renderInWorld(<Article resource={storedPet} root={root} />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Friends' });
    expect(heading).toHaveAttribute('id', 'friends');
    const section = within(heading.closest('section')!);
    expect(section.getByRole('link', { name: 'Crumb' })).toHaveAttribute(
      'href',
      `/worlds/${WORLD_ID}/pet/${FRIEND_ID}`,
    );
    // And a list of plain words is a fact, not a section.
    expect(
      screen.queryByRole('heading', { level: 2, name: 'Tricks' }),
    ).not.toBeInTheDocument();
    expect(infobox().getByText('roll over')).toBeInTheDocument();
  });

  it('offers a table of contents once there are three headings', () => {
    const { unmount } = renderInWorld(
      <Article resource={storedPet} root={root} />,
    );
    const contents = within(
      screen.getByRole('navigation', { name: 'Contents' }),
    );
    expect(contents.getByRole('link', { name: 'Friends' })).toHaveAttribute(
      'href',
      '#friends',
    );
    unmount();
    // One heading is not a table of contents; it is one heading.
    renderInWorld(
      <Article
        resource={{
          id: storedPet.id,
          name: 'Bare',
          friends: storedPet.friends,
        }}
        root={root}
      />,
    );
    expect(
      screen.queryByRole('navigation', { name: 'Contents' }),
    ).not.toBeInTheDocument();
  });

  it('shows what links here as See also, and the sources as numbered references', () => {
    renderInWorld(
      <Article
        resource={{
          ...storedPet,
          citation: [
            {
              work: { type: 'Pet', id: FRIEND_ID, display: 'The Kennel Book' },
              locator: 'page 4',
              quote: 'A small dog indeed.',
            },
          ],
        }}
        root={root}
        seeAlso={<p>Two shows</p>}
      />,
    );
    const seeAlso = screen.getByRole('heading', { level: 2, name: 'See also' });
    expect(
      within(seeAlso.closest('section')!).getByText('Two shows'),
    ).toBeInTheDocument();
    const references = screen.getByRole('heading', {
      level: 2,
      name: 'References',
    });
    const cited = within(references.closest('section')!);
    expect(cited.getByRole('listitem')).toBeInTheDocument();
    expect(
      cited.getByRole('link', { name: 'The Kennel Book' }),
    ).toBeInTheDocument();
    expect(cited.getByText(/page 4/)).toBeInTheDocument();
    expect(cited.getByText(/A small dog indeed/)).toBeInTheDocument();
  });

  it('links a reference and reads in-world time as its year', () => {
    renderInWorld(<Article resource={storedPet} root={root} />);
    expect(screen.getByRole('link', { name: 'Ada' })).toHaveAttribute(
      'href',
      `/worlds/${WORLD_ID}/person/${OWNER_ID}`,
    );
    expect(infobox().getByText('Born').nextElementSibling).toHaveTextContent(
      '1041',
    );
    expect(screen.getByRole('link', { name: '1041' })).toHaveAttribute(
      'href',
      `/worlds/${WORLD_ID}/timeline?from=1041&to=1041`,
    );
  });

  it('shows a shape the schema does not name rather than dropping it', () => {
    renderInWorld(<Article resource={storedPet} root={root} />);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Unknown field' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Extras' }),
    ).toBeInTheDocument();
  });

  it('leaves out what is empty and what the title already said', () => {
    renderInWorld(<Article resource={storedPet} root={root} />);
    expect(screen.queryByText('Weight')).not.toBeInTheDocument();
    expect(screen.queryByText('Seen')).not.toBeInTheDocument();
    expect(screen.queryByText('Recorded')).not.toBeInTheDocument();
    expect(screen.queryByText('World')).not.toBeInTheDocument();
  });
});
