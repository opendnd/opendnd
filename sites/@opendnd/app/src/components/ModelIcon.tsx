import {
  BookMarkedIcon,
  BoxIcon,
  GlobeIcon,
  type LucideIcon,
  MapPinIcon,
  ScrollTextIcon,
  SwordsIcon,
  UsersIcon,
} from 'lucide-react';
import {
  DynamicIcon,
  type IconName,
  dynamicIconImports,
} from 'lucide-react/dynamic';

/** The icon each group of models is shown with, when a model names none of its own. */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  play: SwordsIcon,
  people: UsersIcon,
  places: MapPinIcon,
  history: ScrollTextIcon,
  rules: BookMarkedIcon,
  world: GlobeIcon,
};

export function categoryIcon(key: string | undefined): LucideIcon {
  return (key !== undefined && CATEGORY_ICONS[key]) || BoxIcon;
}

/**
 * A model's icon, as its manifest names it from the icon set the application
 * draws with, loaded on demand so the set is not shipped whole; a model that
 * names none, or names one the set lacks, gets its group's.
 */
export function ModelIcon(props: {
  readonly model: { readonly icon?: string; readonly category?: string };
  readonly className?: string;
}) {
  const Fallback = categoryIcon(props.model.category);
  const name = props.model.icon;
  if (name !== undefined && name in dynamicIconImports) {
    return (
      <DynamicIcon
        name={name as IconName}
        className={props.className}
        aria-hidden
        fallback={() => <Fallback className={props.className} aria-hidden />}
      />
    );
  }
  return <Fallback className={props.className} aria-hidden />;
}
