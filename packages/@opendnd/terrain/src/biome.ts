/**
 * What grows where, from how warm and how wet it is.
 *
 * The codes are the ontology's own `terrain` vocabulary rather than a set
 * invented here, so a cell of the field and a place's `terrain` field say the
 * same word. That is the whole reason for choosing from a list: a generated
 * world and an authored one have to describe their ground alike.
 */

/** The fifteen codes the ontology's `terrain` vocabulary offers. */
export type TerrainCode =
  | 'coastal'
  | 'desert'
  | 'grassland'
  | 'hills'
  | 'mountains'
  | 'plains'
  | 'snow'
  | 'tundra'
  | 'forest'
  | 'river'
  | 'jungle'
  | 'marsh'
  | 'flood-plains'
  | 'lakes'
  | 'oasis';

export const TERRAIN_CODES: readonly TerrainCode[] = [
  'coastal',
  'desert',
  'grassland',
  'hills',
  'mountains',
  'plains',
  'snow',
  'tundra',
  'forest',
  'river',
  'jungle',
  'marsh',
  'flood-plains',
  'lakes',
  'oasis',
];

export interface BiomeInput {
  /** Degrees, roughly Celsius. */
  readonly temperature: number;
  /** 0 dry, 1 as wet as the world gets. */
  readonly moisture: number;
  /** 0 at sea level, 1 at the highest ground. */
  readonly elevation: number;
  /** How far from salt water, in cells. */
  readonly fromShore: number;
  /** Whether a river runs here. */
  readonly river?: boolean;
  /** Whether this is standing fresh water. */
  readonly lake?: boolean;
}

export interface BiomeOptions {
  /** Above this, ground is mountain whatever the weather. */
  readonly mountainAbove?: number;
  /** Above this, ground is hill. */
  readonly hillAbove?: number;
  /** Within this many cells of the sea, ground is coastal. */
  readonly coastWithin?: number;
}

/**
 * The code for one place.
 *
 * Height and water decide first, because they are facts: a mountain is a
 * mountain whatever the rainfall, and a river is a river. Then warmth and
 * wet, in the arrangement Whittaker drew for the real world's biomes — cold
 * to hot up one side, dry to wet along the other.
 */
export function biomeOf(
  input: BiomeInput,
  options: BiomeOptions = {},
): TerrainCode {
  const mountainAbove = options.mountainAbove ?? 0.62;
  const hillAbove = options.hillAbove ?? 0.34;
  const coastWithin = options.coastWithin ?? 2;
  const { temperature, moisture, elevation, fromShore } = input;

  if (input.lake) return 'lakes';
  if (input.river) return 'river';
  if (elevation >= mountainAbove) {
    return temperature < -5 ? 'snow' : 'mountains';
  }
  if (temperature < -8) return 'snow';
  if (temperature < 0) return 'tundra';
  if (fromShore <= coastWithin) return 'coastal';
  if (elevation >= hillAbove) return 'hills';

  // Warm and soaking is jungle; warm and dry is desert; the rest is a
  // gradient between grass, forest and marsh.
  if (temperature >= 21) {
    if (moisture >= 0.62) return 'jungle';
    if (moisture >= 0.34) return 'forest';
    if (moisture >= 0.14) return 'grassland';
    return 'desert';
  }
  if (moisture >= 0.72) return 'marsh';
  if (moisture >= 0.4) return 'forest';
  if (moisture >= 0.16) return 'grassland';
  return temperature >= 15 ? 'desert' : 'plains';
}
