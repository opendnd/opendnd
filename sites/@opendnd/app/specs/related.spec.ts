import { describe, expect, it } from 'vitest';
import {
  dateOf,
  referringFields,
  relatedActions,
  rootOf,
} from 'src/schema/related';
import {
  HAPPENING_ID,
  TROUPE_ID,
  storedShow,
  troupeOntology,
} from './fixtures/troupe';

const ontology = troupeOntology();

describe('what can be made from a record, read from the schemas', () => {
  it('offers a record whose field is fixed to this model, pointing back at it', () => {
    const actions = relatedActions(ontology, 'troupe');
    const show = actions.find((a) => a.target === 'show')!;
    expect(show).toEqual({
      target: 'show',
      label: 'Show',
      description: 'Its troupe will be this troupe.',
      set: 'troupe',
    });
  });

  it('does both when the models point at each other', () => {
    const player = relatedActions(ontology, 'troupe').find(
      (a) => a.target === 'player',
    )!;
    expect(player.set).toBe('troupe');
    expect(player.link).toBe('players');
    expect(player.description).toBe(
      "Its troupe will be this troupe. It will be added to this troupe's players.",
    );
  });

  it('offers what this record refers to, to be added to the field that does', () => {
    const actions = relatedActions(ontology, 'show');
    const happening = actions.find((a) => a.target === 'happening')!;
    expect(happening.set).toBeUndefined();
    expect(happening.link).toBe('produced');
    // A field that may point at anything is not an invitation.
    expect(actions.filter((a) => a.target === 'happening')).toHaveLength(1);
    expect(actions.map((a) => a.target).sort()).toEqual([
      'happening',
      'troupe',
    ]);
  });

  it('names the field when more than one could carry the link', () => {
    const labels = relatedActions(ontology, 'player')
      .filter((a) => a.target === 'player')
      .map((a) => a.label);
    expect(labels).toEqual([
      'Player · stands in for',
      'Player · understudy of',
    ]);
  });

  it('offers a record whose list field is fixed to this model, holding it', () => {
    expect(relatedActions(ontology, 'happening')).toEqual([
      {
        target: 'show',
        label: 'Show',
        description: 'Its produced will include this happening.',
        set: 'produced',
      },
    ]);
  });
});

describe('reading a record that refers to another', () => {
  it('finds the fields a reference sits under, however deep', () => {
    expect(referringFields(storedShow, TROUPE_ID)).toEqual(['troupe']);
    expect(referringFields(storedShow, HAPPENING_ID)).toEqual(['produced']);
    expect(referringFields(storedShow, 'nobody')).toEqual([]);
  });

  it('finds the first date a record carries', () => {
    expect(dateOf(storedShow, rootOf(ontology, 'show'))).toEqual({
      label: 'Played on',
      value: '2026-03-14',
      kind: 'date',
    });
    expect(dateOf({ name: 'x' }, rootOf(ontology, 'show'))).toBeUndefined();
  });
});
