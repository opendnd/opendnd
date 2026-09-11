import {
  AwardIcon,
  BackpackIcon,
  BookOpenIcon,
  CalendarClockIcon,
  CompassIcon,
  DicesIcon,
  FileTextIcon,
  HeartPulseIcon,
  HistoryIcon,
  ImageIcon,
  LayoutGridIcon,
  type LucideIcon,
  MapIcon,
  MessageSquareIcon,
  NotebookPenIcon,
  ScrollTextIcon,
  SearchIcon,
  ShieldIcon,
  SmileIcon,
  SparklesIcon,
  SwordsIcon,
  TableIcon,
  TargetIcon,
  UserIcon,
  UsersIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import {
  AskBlock,
  CampaignsBlock,
  CountsBlock,
  RecentBlock,
} from './blocks/home';
import {
  SheetAbilities,
  SheetChecks,
  SheetCombat,
  SheetEquipment,
  SheetHeader,
  SheetSpells,
  SheetTraining,
} from './blocks/sheet';
import { CampaignList } from '../pages/Campaigns';
import { CharacterList } from '../pages/Characters';
import { CompendiumSurface } from '../pages/Compendium';
import { MapSurface } from '../pages/Map';
import { RulesSurface } from '../pages/Rules';
import { TimelineSurface } from '../pages/Timeline';

/**
 * The blocks a page can be built from.
 *
 * This is a catalogue rather than a set of imports: each entry says what the
 * block is for, which models it reads, how big it wants to be, and whether it
 * can be placed at all. A block with no `render` is one the marketplace lists
 * and nobody can use yet — the catalogue tells the truth about what exists,
 * so nothing can promise a page made of blocks that were never written.
 *
 * A block takes only its options and, on a record page, the record. It reads
 * everything else — the world, the ontology, who is looking — from context,
 * which is what lets the same block sit on any page.
 */

export type BlockCategory =
  | 'Play'
  | 'World'
  | 'Reference'
  | 'Making'
  | 'Writing';

/**
 * Where a block stands. `available` can be placed today; `roadmap` is planned
 * work; `third-party` would come from somebody else. The last two are listed
 * and cannot be placed.
 */
export type BlockStatus = 'available' | 'roadmap' | 'third-party';

export interface BlockProps {
  readonly options?: Record<string, unknown>;
  /** The record a record-scoped page is about. */
  readonly record?: Record<string, unknown>;
}

export interface Block {
  readonly id: string;
  readonly name: string;
  readonly category: BlockCategory;
  readonly description: string;
  readonly icon: LucideIcon;
  /** The models it reads, so a world without them can be told. */
  readonly bindings: readonly string[];
  /** Its footprint when first placed, in grid cells. */
  readonly size: { readonly w: number; readonly h: number };
  /** A record block needs a record; a world block does not. */
  readonly scope?: 'world' | 'record';
  readonly status?: BlockStatus;
  readonly render?: (props: BlockProps) => ReactNode;
}

const block = (one: Block) => one;

export const BLOCKS: readonly Block[] = [
  block({
    id: 'ask',
    name: 'Ask the world',
    category: 'World',
    description:
      'A question in plain words, answered from the records and told which ones it drew on.',
    icon: CompassIcon,
    bindings: [],
    size: { w: 6, h: 4 },
    render: () => <AskBlock />,
  }),
  block({
    id: 'counts',
    name: 'What the world holds',
    category: 'World',
    description:
      'How many campaigns, characters and works are on record, each one a way in.',
    icon: LayoutGridIcon,
    bindings: ['campaign', 'character-sheet', 'work'],
    size: { w: 6, h: 1 },
    render: () => <CountsBlock />,
  }),
  block({
    id: 'campaigns',
    name: 'Campaigns played',
    category: 'Play',
    description: 'The most recently played campaigns, as cards.',
    icon: SwordsIcon,
    bindings: ['campaign'],
    size: { w: 6, h: 2 },
    render: (props) => <CampaignsBlock options={props.options} />,
  }),
  block({
    id: 'campaign-list',
    name: 'All campaigns',
    category: 'Play',
    description:
      'Every campaign in the world, with somewhere to start a new one.',
    icon: SwordsIcon,
    bindings: ['campaign'],
    size: { w: 6, h: 4 },
    render: () => <CampaignList />,
  }),
  block({
    id: 'character-list',
    name: 'Characters',
    category: 'Play',
    description: 'The people as played, as cards, with somewhere to add one.',
    icon: UsersIcon,
    bindings: ['character-sheet'],
    size: { w: 6, h: 4 },
    render: () => <CharacterList />,
  }),
  block({
    id: 'recent',
    name: 'Recently changed',
    category: 'World',
    description: 'What was written last, across the surfaces a world offers.',
    icon: HistoryIcon,
    bindings: ['campaign', 'character-sheet', 'work'],
    size: { w: 6, h: 2 },
    render: (props) => <RecentBlock options={props.options} />,
  }),
  block({
    id: 'map',
    name: 'World map',
    category: 'World',
    description:
      'The world drawn from its own coastlines, at any year, with what is in view beside it.',
    icon: MapIcon,
    bindings: ['place', 'scene'],
    size: { w: 6, h: 4 },
    render: () => <MapSurface />,
  }),
  block({
    id: 'timeline',
    name: 'Timeline',
    category: 'World',
    description: 'Everything dated, in the order it began.',
    icon: CalendarClockIcon,
    bindings: ['event', 'session', 'tenure'],
    size: { w: 6, h: 4 },
    render: () => <TimelineSurface />,
  }),
  block({
    id: 'compendium',
    name: 'Compendium',
    category: 'Reference',
    description:
      'Articles, chronicles and tales, and a search across everything on record.',
    icon: BookOpenIcon,
    bindings: ['work'],
    size: { w: 6, h: 4 },
    render: () => <CompendiumSurface />,
  }),
  block({
    id: 'rules',
    name: 'Rules',
    category: 'Reference',
    description:
      'The game as this world has it: species, classes, feats, items, spells and stat blocks.',
    icon: ShieldIcon,
    bindings: ['species', 'class', 'feat', 'item', 'spell', 'statblock'],
    size: { w: 6, h: 4 },
    render: () => <RulesSurface />,
  }),

  // The character sheet, which is the arrangement a player already knows,
  // arrived at the same way as any other page.
  block({
    id: 'sheet-header',
    name: 'Character header',
    category: 'Play',
    description:
      'Who this is: their name, their classes and level, their background, and who plays them.',
    icon: UserIcon,
    bindings: ['character-sheet', 'class', 'background', 'character'],
    size: { w: 6, h: 1 },
    scope: 'record',
    render: (props) => <SheetHeader record={props.record} />,
  }),
  block({
    id: 'sheet-abilities',
    name: 'Ability scores',
    category: 'Play',
    description:
      'The six scores and their modifiers. Click a score to change it and the whole sheet follows.',
    icon: DicesIcon,
    bindings: ['character-sheet'],
    size: { w: 2, h: 2 },
    scope: 'record',
    render: (props) => <SheetAbilities record={props.record} />,
  }),
  block({
    id: 'sheet-checks',
    name: 'Saves and skills',
    category: 'Play',
    description:
      'Saving throws and every skill the world has, with the proficiency bonus where it applies.',
    icon: TargetIcon,
    bindings: ['character-sheet', 'skill', 'proficiency'],
    size: { w: 2, h: 4 },
    scope: 'record',
    render: (props) => <SheetChecks record={props.record} />,
  }),
  block({
    id: 'sheet-combat',
    name: 'Hit points and combat',
    category: 'Play',
    description:
      'Hit points as they stand, hit dice, initiative, what is noticed without looking, and any conditions.',
    icon: HeartPulseIcon,
    bindings: ['character-sheet', 'class', 'condition'],
    size: { w: 4, h: 2 },
    scope: 'record',
    render: (props) => <SheetCombat record={props.record} />,
  }),
  block({
    id: 'sheet-training',
    name: 'Feats and proficiencies',
    category: 'Play',
    description: 'What this character can do that another of their level cannot.',
    icon: AwardIcon,
    bindings: ['character-sheet', 'feat', 'proficiency'],
    size: { w: 2, h: 2 },
    scope: 'record',
    render: (props) => <SheetTraining record={props.record} />,
  }),
  block({
    id: 'sheet-equipment',
    name: 'Equipment',
    category: 'Play',
    description: 'What the character carries, what is in hand and what is attuned.',
    icon: BackpackIcon,
    bindings: ['character-sheet', 'item'],
    size: { w: 2, h: 2 },
    scope: 'record',
    render: (props) => <SheetEquipment record={props.record} />,
  }),
  block({
    id: 'sheet-spells',
    name: 'Spells',
    category: 'Play',
    description: 'Spells known and prepared, and the slots spent since the last rest.',
    icon: SparklesIcon,
    bindings: ['character-sheet', 'spell'],
    size: { w: 6, h: 2 },
    scope: 'record',
    render: (props) => <SheetSpells record={props.record} />,
  }),

  // Listed, not yet written. The marketplace shows these so that a page can
  // be planned around them and nobody is promised one that does not exist.
  block({
    id: 'sheet-attacks',
    name: 'Attacks',
    category: 'Play',
    description:
      'What the character swings and throws, with the bonus to hit and the damage.',
    icon: SwordsIcon,
    bindings: ['character-sheet', 'item', 'statblock'],
    size: { w: 4, h: 2 },
    scope: 'record',
    status: 'roadmap',
  }),
  block({
    id: 'sheet-personality',
    name: 'Personality',
    category: 'Play',
    description: 'Traits, ideals, bonds and flaws — what the character is like.',
    icon: SmileIcon,
    bindings: ['character-sheet', 'background'],
    size: { w: 2, h: 2 },
    scope: 'record',
    status: 'roadmap',
  }),
  block({
    id: 'article',
    name: 'Article',
    category: 'Writing',
    description: 'A record as an encyclopedia page: lead, infobox, sections.',
    icon: FileTextIcon,
    bindings: [],
    size: { w: 4, h: 4 },
    scope: 'record',
    status: 'roadmap',
  }),
  block({
    id: 'record-table',
    name: 'Record table',
    category: 'Reference',
    description: 'Any model as a sortable table, filtered how you leave it.',
    icon: TableIcon,
    bindings: [],
    size: { w: 6, h: 3 },
    status: 'roadmap',
  }),
  block({
    id: 'search',
    name: 'Search',
    category: 'Reference',
    description: 'One box across everything the world has on record.',
    icon: SearchIcon,
    bindings: [],
    size: { w: 2, h: 1 },
    status: 'roadmap',
  }),
  block({
    id: 'picture',
    name: 'Picture',
    category: 'Making',
    description: 'A picture from the world’s own files, or from the web.',
    icon: ImageIcon,
    bindings: [],
    size: { w: 2, h: 2 },
    status: 'roadmap',
  }),
  block({
    id: 'note',
    name: 'Note',
    category: 'Making',
    description: 'A piece of writing that belongs to the page, not to a record.',
    icon: NotebookPenIcon,
    bindings: [],
    size: { w: 2, h: 2 },
    status: 'roadmap',
  }),
  block({
    id: 'session-log',
    name: 'Session log',
    category: 'Play',
    description: 'What happened last time, and what was left unfinished.',
    icon: ScrollTextIcon,
    bindings: ['session'],
    size: { w: 3, h: 2 },
    status: 'roadmap',
  }),
  block({
    id: 'chat',
    name: 'Table chat',
    category: 'Play',
    description: 'Talk at the table, kept with the session it belongs to.',
    icon: MessageSquareIcon,
    bindings: ['session'],
    size: { w: 2, h: 4 },
    status: 'third-party',
  }),
];

const byId = new Map(BLOCKS.map((one) => [one.id, one]));

export function blockById(id: string): Block | undefined {
  return byId.get(id);
}

/** Whether a block can actually be put on a page. */
export function isPlaceable(one: Block): boolean {
  return one.render !== undefined && (one.status ?? 'available') === 'available';
}
