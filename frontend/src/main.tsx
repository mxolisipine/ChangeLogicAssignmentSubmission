import React, { useState, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setCurrentUserId } from './api';
import { ManagerScreen } from './ManagerScreen';
import { MemberScreen } from './MemberScreen';
import { UserSelector } from './UserSelector';
import type { UserListItem } from './types';

/**
 * App — root component.
 *
 * State machine:
 *   selectedUser === null  →  show prompt to select a user
 *   selectedUser.role === 'MEMBER'   →  MemberScreen
 *   selectedUser.role === 'MANAGER'  →  ManagerScreen
 *
 * The UserSelector is always visible at the top.
 * Changing the selected user resets the active screen entirely.
 */
function App(): React.JSX.Element {
  const [selectedUser, setSelectedUser] = useState<UserListItem | null>(null);

  function handleUserSelect(user: UserListItem | null): void {
    // Update the module-level auth header used by all API calls
    setCurrentUserId(user?.id ?? null);
    setSelectedUser(user);
  }

  return (
    <>
      <UserSelector onSelect={handleUserSelect} />
      <main>
        {selectedUser === null && (
          <p
            style={{
              padding: '32px 16px',
              textAlign: 'center',
              color: '#555',
              fontFamily: 'sans-serif',
            }}
          >
            Select a user from the dropdown above to get started.
          </p>
        )}

        {selectedUser?.role === 'MEMBER' && <MemberScreen key={selectedUser.id} />}

        {selectedUser?.role === 'MANAGER' && <ManagerScreen key={selectedUser.id} />}
      </main>
    </>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in DOM');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
