import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SchemaForm } from 'src/components/Form';
import { type Field, describe as describeSchema } from 'src/schema/fields';
import { initialValue, prune } from 'src/schema/value';
import { FRIEND_ID, petOntology } from './fixtures/ontology';
import { fakeFetch, renderInWorld } from './helpers';

const ontology = petOntology();
const root: Field = describeSchema(ontology.schema('pet', 'input')!, ontology, {
  name: 'pet',
});

/** The form as a page would hold it: controlled, submitting the pruned value. */
function Harness(props: { onSubmit(value: unknown): void }) {
  const [value, setValue] = useState(
    initialValue(root) as Record<string, unknown>,
  );
  return (
    <SchemaForm
      root={root}
      value={value}
      onChange={setValue}
      onSubmit={() => props.onSubmit(prune(value))}
      submitLabel="Create"
    />
  );
}

describe('a form built from a schema', () => {
  it('renders a control per field and submits what was typed, pruned', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderInWorld(<Harness onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/^Name/), 'Biscuit');
    await user.selectOptions(screen.getByLabelText(/^Mood/), 'sad');
    await user.type(screen.getByLabelText(/^Legs/), '4');
    await user.selectOptions(screen.getByLabelText(/^Friendly/), 'true');

    await user.click(screen.getByRole('button', { name: 'Add trick' }));
    const tricks = screen.getByText('Tricks').closest('div')!;
    await user.type(within(tricks).getByRole('textbox'), 'sit');

    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Biscuit',
      perspective: 'in-universe',
      mood: 'sad',
      legs: 4,
      friendly: true,
      tricks: ['sit'],
    });
  });

  it('labels choices with the vocabulary and marks required fields', () => {
    renderInWorld(<Harness onSubmit={() => undefined} />);
    const mood = screen.getByLabelText(/^Mood/) as HTMLSelectElement;
    expect(
      within(mood).getByRole('option', { name: 'Happy' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Mood').parentElement).toHaveTextContent('*');
    expect(screen.getByText('How the pet feels.')).toBeInTheDocument();
  });

  it('folds record keeping away and shows it on request', async () => {
    const user = userEvent.setup();
    renderInWorld(<Harness onSubmit={() => undefined} />);
    expect(screen.queryByLabelText(/^Perspective/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Record keeping/ }));
    expect(screen.getByLabelText(/^Perspective/)).toHaveValue('in-universe');
  });

  it('adds an optional object with its defaults and removes it again', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderInWorld(<Harness onSubmit={onSubmit} />);
    await user.click(screen.getByRole('button', { name: 'Add born' }));
    expect(screen.getByLabelText(/^Precision/)).toHaveValue('year');
    await user.type(screen.getByLabelText(/^Year/), '1041');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSubmit.mock.lastCall?.[0]).toMatchObject({
      born: { year: 1041, precision: 'year' },
    });

    await user.click(screen.getByRole('button', { name: 'Remove born' }));
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSubmit.mock.lastCall?.[0]).not.toHaveProperty('born');
  });

  it('picks a reference by searching the world', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { fetch } = fakeFetch({
      'GET /v1/worlds/44444444-4444-4444-8444-444444444444/$search': (
        _,
        url,
      ) =>
        url.searchParams.get('q') === 'Cru'
          ? {
              results: [
                {
                  model: 'pet',
                  id: FRIEND_ID,
                  name: 'Crumb',
                  canonStatus: 'canon',
                },
              ],
            }
          : { results: [] },
    });
    renderInWorld(<Harness onSubmit={onSubmit} />, { fetch });

    await user.type(screen.getByLabelText(/^Owner/), 'Cru');
    await user.click(await screen.findByRole('option', { name: /Crumb/ }));
    expect(screen.getByRole('link', { name: 'Crumb' })).toHaveAttribute(
      'href',
      `/worlds/44444444-4444-4444-8444-444444444444/pet/${FRIEND_ID}`,
    );

    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSubmit.mock.lastCall?.[0]).toMatchObject({
      owner: { model: 'pet', id: FRIEND_ID, name: 'Crumb' },
    });
  });

  it('edits a shape it has no control for as JSON, and says when it is not JSON', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderInWorld(<Harness onSubmit={onSubmit} />);
    const extras = screen.getByLabelText(/^Extras/);
    await user.type(extras, '{{"collar": "red"}');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSubmit.mock.lastCall?.[0]).toMatchObject({
      extras: { collar: 'red' },
    });

    await user.clear(extras);
    await user.type(extras, 'not json');
    await user.tab();
    await waitFor(() => expect(extras).toHaveAttribute('aria-invalid', 'true'));
  });
});
