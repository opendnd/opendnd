import { useWorld } from '../app/world';
import { Transfer as TransferPanel } from '../components/Transfer';

/**
 * Taking a world out and bringing one back.
 *
 * What used to stand here was an overview of every kind of record the API
 * serves. That is documentation, and it belongs in the documentation; the
 * sidebar already lists the kinds, and each opens its own table. What is
 * left is the thing that is not documentation.
 */
export function Transfer() {
  const { world } = useWorld();
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl">Export and import</h1>
        <p className="text-sm text-muted-foreground">
          Everything in {world.name} as one bundle, to keep, to move to another
          deployment, or to read. Anyone who can read the world can export it;
          only an editor can bring one in.
        </p>
      </header>
      <TransferPanel />
    </div>
  );
}
