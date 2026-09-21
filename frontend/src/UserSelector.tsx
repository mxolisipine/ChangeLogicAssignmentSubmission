import React, { useEffect, useState } from 'react';
import { getUsers } from './api';
import type { UserListItem } from './types';

interface Props {
  onSelect: (user: UserListItem | null) => void;
}

/**
 * Always-visible dropdown that lists all seeded users.
 * Selecting a user triggers onSelect, which the parent uses to:
 *   - set the X-User-Id header via setCurrentUserId()
 *   - fetch /auth/me and route to the correct screen
 */
export function UserSelector({ onSelect }: Props): React.JSX.Element {
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');

  useEffect(() => {
    getUsers()
      .then(setUsers)
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : 'Failed to load users');
      });
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    const id = e.target.value;
    setSelectedId(id);
    if (!id) {
      onSelect(null);
      return;
    }
    const user = users.find((u) => u.id === id) ?? null;
    onSelect(user);
  }

  if (loadError) {
    return (
      <div style={styles.bar}>
        <strong>Pulse Surveys</strong>
        <span style={{ color: '#c00' }}>Could not load users: {loadError}</span>
      </div>
    );
  }

  return (
    <div style={styles.bar}>
      <strong>Pulse Surveys</strong>
      <label htmlFor="user-select" style={{ marginLeft: 16 }}>
        Logged in as:&nbsp;
      </label>
      <select
        id="user-select"
        value={selectedId}
        onChange={handleChange}
        style={styles.select}
      >
        <option value="">— select a user —</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} ({u.organizationName} · {u.role})
          </option>
        ))}
      </select>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 16px',
    background: '#1a1a2e',
    color: '#fff',
    gap: 8,
  },
  select: {
    padding: '4px 8px',
    fontSize: 14,
    borderRadius: 4,
    border: '1px solid #555',
    background: '#fff',
    color: '#000',
    cursor: 'pointer',
  },
};
