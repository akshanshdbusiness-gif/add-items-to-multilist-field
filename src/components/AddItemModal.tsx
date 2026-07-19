'use client';

import { useMemo, useState, type FormEvent } from 'react';
import type { ItemSummary } from '@/src/lib/sitecore/queries';

export interface AddItemSubmission {
  name: string;
  copyFromItemId?: string;
}

interface AddItemModalProps {
  selectedItems: ItemSummary[];
  onClose: () => void;
  onSubmit: (input: AddItemSubmission) => Promise<void>;
}

export function AddItemModal({ selectedItems, onClose, onSubmit }: AddItemModalProps) {
  const [name, setName] = useState('');
  const [copyFromItemId, setCopyFromItemId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedItems = useMemo(
    () =>
      [...selectedItems].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      ),
    [selectedItems],
  );

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Enter a name for the new item.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        name: trimmedName,
        copyFromItemId: copyFromItemId || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-item-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="add-item-modal-title">Add item</h2>
        <form onSubmit={handleSubmit}>
          <label className="modal-field">
            Name
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={submitting}
              autoFocus
            />
          </label>

          {sortedItems.length > 0 && (
            <label className="modal-field">
              Copy fields from an existing item (optional)
              <select
                value={copyFromItemId}
                onChange={(event) => setCopyFromItemId(event.target.value)}
                disabled={submitting}
              >
                <option value="">Start blank</option>
                {sortedItems.map((item) => (
                  <option key={item.itemId} value={item.itemId}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {error && (
            <p role="alert" className="modal-error">
              {error}
            </p>
          )}

          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" disabled={submitting}>
              {submitting ? 'Adding…' : 'Add item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
