import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * Application entry point.
 *
 * Feature screens (LoginScreen, MemberSurveyScreen, ManagerSummaryScreen)
 * will be wired in here once implemented.
 */
function App(): React.JSX.Element {
  return (
    <div>
      <h1>Pulse Surveys</h1>
      <p>Scaffold only — feature screens coming next.</p>
    </div>
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
