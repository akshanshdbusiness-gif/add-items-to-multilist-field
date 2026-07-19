import type { ItemSummary } from '@/src/lib/sitecore/queries';

interface SelectedItemCardProps {
  item: ItemSummary;
  isLocal: boolean;
}

export function SelectedItemCard({ item, isLocal }: SelectedItemCardProps) {
  return (
    <div className="item-card">
      <div className="item-card-header">
        <span className="item-card-name">{item.name}</span>
        <span className={`item-card-scope ${isLocal ? 'local' : 'shared'}`}>
          {isLocal ? 'Local' : 'Shared'}
        </span>
      </div>
      <span className="item-card-path">{item.path}</span>
    </div>
  );
}
