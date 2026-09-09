import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RECORD_PAGES } from 'src/build/pages';
import { blockById, isPlaceable } from 'src/build/blocks';
import { isFree } from 'src/build/grid';
import { recordLayoutFor } from 'src/build/project';
import { EditingProvider } from 'src/build/sheet/Editable';
import {
  SheetAbilities,
  SheetCombat,
  SheetHeader,
} from 'src/build/blocks/sheet';
import { renderInWorld } from './helpers';

const arodyf = {
  id: '903b3a19-b991-5f86-bf39-228583794dfc',
  name: 'Arodyf',
  level: 4,
  abilityScores: {
    strength: 17,
    dexterity: 14,
    constitution: 15,
    intelligence: 10,
    wisdom: 12,
    charisma: 8,
  },
  hitPoints: { current: 19, maximum: 27 },
  hitDiceSpent: 1,
};

describe('a character sheet', () => {
  it('shows a modifier for every score, and the level and bonus above them', () => {
    renderInWorld(
      <>
        <SheetHeader record={arodyf} />
        <SheetAbilities record={arodyf} />
      </>,
    );
    expect(screen.getByText('Level').nextSibling).toHaveTextContent('4');
    // Two at first level, and still two at fourth.
    expect(screen.getByText('Proficiency').nextSibling).toHaveTextContent('+2');
    const abilities = within(screen.getByText('Abilities').closest('section')!);
    for (const [short, modifier] of [
      ['STR', '+3'],
      ['DEX', '+2'],
      ['CON', '+2'],
      ['INT', '+0'],
      ['WIS', '+1'],
      ['CHA', '−1'],
    ]) {
      const cell = abilities.getByText(short).parentElement!;
      expect(cell).toHaveTextContent(modifier!);
    }
  });

  it('reads hit points as they stand, and says how many hit dice are spent', () => {
    renderInWorld(<SheetCombat record={arodyf} />);
    const combat = within(screen.getByText('Combat').closest('section')!);
    expect(
      combat.getByRole('img', { name: /19 of 27 hit points/ }),
    ).toBeInTheDocument();
    // Initiative is dexterity, and nothing had to store it.
    expect(combat.getByText('Initiative').nextSibling).toHaveTextContent('+2');
    expect(combat.getByText('Spent').nextSibling).toHaveTextContent('1');
  });

  it('writes a score where it stands, and does not write one that did not change', async () => {
    const user = userEvent.setup();
    const saved = vi.fn();
    const { services } = renderInWorld(
      <EditingProvider model="character" id={arodyf.id} canEdit onSaved={saved}>
        <SheetAbilities record={arodyf} />
      </EditingProvider>,
    );
    const patch = vi.spyOn(services.api, 'patch').mockResolvedValue({
      body: arodyf,
      etag: undefined,
    } as never);

    await user.click(screen.getByRole('button', { name: /^strength: 17/ }));
    const field = screen.getByRole('spinbutton', { name: 'strength' });
    await user.clear(field);
    await user.type(field, '18{Enter}');
    expect(patch).toHaveBeenCalledWith(
      expect.any(String),
      'character',
      arodyf.id,
      { abilityScores: { ...arodyf.abilityScores, strength: 18 } },
    );

    // Typing the number that was already there is not a change to write.
    patch.mockClear();
    await user.click(screen.getByRole('button', { name: /^strength: 17/ }));
    await user.type(
      screen.getByRole('spinbutton', { name: 'strength' }),
      '{Enter}',
    );
    expect(patch).not.toHaveBeenCalled();
  });

  it('is read only for somebody who cannot edit the world', () => {
    renderInWorld(
      <EditingProvider
        model="character"
        id={arodyf.id}
        canEdit={false}
        onSaved={() => undefined}
      >
        <SheetAbilities record={arodyf} />
      </EditingProvider>,
    );
    expect(
      screen.queryByRole('button', { name: /strength/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('17')).toBeInTheDocument();
  });
});

describe('the sheet as a page', () => {
  it('is a layout of blocks that exist, none of them over another', () => {
    const page = RECORD_PAGES.character;
    const laid: (typeof page.blocks)[number][] = [];
    for (const placed of page.blocks) {
      const block = blockById(placed.block);
      expect(block, placed.block).toBeDefined();
      expect(isPlaceable(block!), placed.block).toBe(true);
      expect(block!.scope, placed.block).toBe('record');
      expect(isFree(placed, laid), placed.id).toBe(true);
      laid.push(placed);
    }
  });

  it('is found for a character and for nothing else, until a world says otherwise', () => {
    expect(recordLayoutFor('character', [])).toBeDefined();
    expect(recordLayoutFor('place', [])).toBeUndefined();
  });
});
