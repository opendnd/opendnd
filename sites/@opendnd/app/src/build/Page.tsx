import type { CSSProperties } from 'react';
import { type Block, blockById, isPlaceable } from './blocks';
import {
  CELL_GAP_PX,
  CELL_HEIGHT_PX,
  GRID_COLS,
  type Placed,
  inReadingOrder,
} from './grid';
import { useIsMobile } from '../hooks/use-mobile';
import { Notice } from '../components/Notice';

/**
 * A page: blocks placed on the grid.
 *
 * This is the whole of how a page is drawn, and it is the same renderer for a
 * page that ships with the application, a page a world has made its own, and
 * a page still being dragged about on the canvas. There is no second
 * implementation for "published", so a page cannot look different once it is
 * finished from how it looked while it was being built.
 *
 * On a narrow window the six columns become two and the blocks run down the
 * page in reading order, which is the same reflow the canvas previews.
 */

export interface PageLayout {
  /**
   * How the rows are sized. `fit` gives each row the standard cell height and
   * lets a block grow past it when its content needs the room, which is what
   * a page of lists wants. `fill` shares the height of the window between the
   * rows, which is what a page that is one map or one timeline wants.
   */
  readonly rows: 'fit' | 'fill';
  readonly blocks: readonly Placed[];
}

export interface PageProps {
  readonly page: PageLayout;
  /** The record a record-scoped page is about. */
  readonly record?: Record<string, unknown>;
}

export function Page(props: PageProps) {
  const { page, record } = props;
  const mobile = useIsMobile();
  const cols = mobile ? 2 : GRID_COLS;
  const fill = page.rows === 'fill';
  const style: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
    // A row is at least a cell tall and grows with what is on it, rather than
    // clipping it. A clinic's dashboard wants fixed windows; a world's pages
    // are documents, and a list of campaigns is however long it is.
    gridAutoRows: fill ? 'minmax(0, 1fr)' : `minmax(${CELL_HEIGHT_PX}px, auto)`,
    gridAutoFlow: mobile ? 'row dense' : 'row',
    gap: CELL_GAP_PX,
    ...(fill ? { height: '100%', minHeight: 0 } : {}),
  };
  return (
    <div style={style} className={fill ? 'h-full min-h-0' : undefined}>
      {inReadingOrder(page.blocks).map((placed) => (
        <div
          key={placed.id}
          className="min-w-0"
          style={
            mobile
              ? {
                  gridColumn: `span ${Math.min(placed.w, cols)}`,
                  gridRow: `span ${placed.h}`,
                }
              : {
                  gridColumn: `${placed.col} / span ${placed.w}`,
                  gridRow: `${placed.row} / span ${placed.h}`,
                }
          }
        >
          <Placed placed={placed} record={record} />
        </div>
      ))}
    </div>
  );
}

function Placed(props: {
  readonly placed: Placed;
  readonly record?: Record<string, unknown>;
}) {
  const { placed, record } = props;
  const block = blockById(placed.block);
  if (!block) return <Missing id={placed.block} />;
  if (!isPlaceable(block)) return <NotYet block={block} />;
  return (
    <>
      {block.render!({
        ...(placed.options ? { options: placed.options } : {}),
        ...(record ? { record } : {}),
      })}
    </>
  );
}

/**
 * A page asking for a block this application does not have.
 *
 * It happens the moment pages can be carried between worlds: a page made
 * where a block was installed, opened where it was not. Saying so is better
 * than a blank space, and far better than a broken page.
 */
function Missing(props: { readonly id: string }) {
  return (
    <Notice tone="warning" title="A block is missing">
      This page asks for <code className="font-mono">{props.id}</code>, which
      is not installed here.
    </Notice>
  );
}

function NotYet(props: { readonly block: Block }) {
  return (
    <Notice title={props.block.name}>
      {props.block.description} Not built yet.
    </Notice>
  );
}
