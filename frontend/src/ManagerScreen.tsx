import React, { useCallback, useEffect, useState } from 'react';
import { ApiError, getActiveSurvey, getSummary } from './api';
import type { QuestionSummary, SurveySummary } from './types';

/**
 * Manager summary screen.
 *
 * Flow:
 *   1. On mount: fetch GET /surveys/active to get the survey id and title.
 *   2. Fetch GET /surveys/:id/summary for completion and per-question rollups.
 *   3. Render completion count, rate, and per-question breakdowns.
 *   4. Refresh button repeats step 2 (without re-fetching the survey).
 *
 * Switching users in the parent re-mounts this component via key={user.id},
 * so each manager always sees their own organization's data.
 */
export function ManagerScreen(): React.JSX.Element {
  const [surveyId, setSurveyId] = useState<string | null>(null);
  const [surveyTitle, setSurveyTitle] = useState<string>('');
  const [summary, setSummary] = useState<SurveySummary | null>(null);

  // Separate loading states so the refresh button doesn't blank the whole page
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noSurvey, setNoSurvey] = useState(false);

  // ── Fetch the summary for the already-loaded survey id ─────────────────────
  const fetchSummary = useCallback(
    async (id: string, isRefresh: boolean): Promise<void> => {
      if (isRefresh) setRefreshing(true);
      setError(null);
      try {
        const data = await getSummary(id);
        setSummary(data);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load summary.');
      } finally {
        if (isRefresh) setRefreshing(false);
      }
    },
    [],
  );

  // ── On mount: fetch the active survey, then immediately fetch its summary ──
  useEffect(() => {
    setInitialLoading(true);
    setNoSurvey(false);
    setError(null);
    setSummary(null);

    getActiveSurvey()
      .then((survey) => {
        setSurveyId(survey.id);
        setSurveyTitle(survey.title);
        return fetchSummary(survey.id, false);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) {
          setNoSurvey(true);
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load survey.');
        }
      })
      .finally(() => setInitialLoading(false));
  }, [fetchSummary]);

  // ── Handlers ────────────────────────────────────────────────────────────────
  function handleRefresh(): void {
    if (surveyId) void fetchSummary(surveyId, true);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (initialLoading) {
    return <p style={styles.muted}>Loading summary…</p>;
  }

  if (noSurvey) {
    return <p style={styles.muted}>No active survey for your organization.</p>;
  }

  if (error && !summary) {
    return <p style={styles.errorText}>Error: {error}</p>;
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>{surveyTitle}</h2>
          {summary && (
            <p style={styles.weekLabel}>Week: {summary.week}</p>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          style={refreshing ? styles.refreshBtnDisabled : styles.refreshBtn}
        >
          {refreshing ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {error && <p style={styles.errorText}>{error}</p>}

      {summary && (
        <>
          {/* Completion */}
          <section style={styles.card}>
            <h3 style={styles.sectionTitle}>Completion</h3>
            <p style={styles.stat}>
              <span style={styles.statValue}>
                {summary.completion.count} / {summary.completion.totalMembers}
              </span>
              {' '}members completed
            </p>
            <p style={styles.stat}>
              Completion rate:{' '}
              <span style={styles.statValue}>
                {(summary.completion.rate * 100).toFixed(1)}%
              </span>
            </p>
          </section>

          {/* Per-question rollups */}
          <section>
            <h3 style={styles.sectionTitle}>Questions</h3>
            {summary.questions.map((q) => (
              <QuestionCard key={q.id} question={q} />
            ))}
          </section>
        </>
      )}
    </div>
  );
}

// ─── QuestionCard ─────────────────────────────────────────────────────────────

function QuestionCard({ question }: { question: QuestionSummary }): React.JSX.Element {
  return (
    <div style={styles.card}>
      <p style={styles.questionText}>{question.text}</p>
      {question.type === 'RATING' ? (
        <p style={styles.rollup}>
          Average:{' '}
          <strong>
            {question.average !== null ? question.average.toFixed(2) : '—'}
          </strong>
          {'  ·  '}Responses: <strong>{question.count}</strong>
        </p>
      ) : (
        <p style={styles.rollup}>
          Yes: <strong>{question.yes}</strong>
          {'  ·  '}
          No: <strong>{question.no}</strong>
        </p>
      )}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 640,
    margin: '24px auto',
    padding: '0 16px',
    fontFamily: 'sans-serif',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
    gap: 12,
  },
  title: {
    margin: 0,
    fontSize: 20,
    fontWeight: 600,
  },
  weekLabel: {
    margin: '4px 0 0',
    color: '#666',
    fontSize: 14,
  },
  refreshBtn: {
    padding: '7px 16px',
    fontSize: 13,
    border: '1px solid #1a1a2e',
    borderRadius: 4,
    background: '#1a1a2e',
    color: '#fff',
    cursor: 'pointer',
    flexShrink: 0,
  },
  refreshBtnDisabled: {
    padding: '7px 16px',
    fontSize: 13,
    border: '1px solid #aaa',
    borderRadius: 4,
    background: '#aaa',
    color: '#fff',
    cursor: 'not-allowed',
    flexShrink: 0,
  },
  sectionTitle: {
    margin: '0 0 12px',
    fontSize: 15,
    fontWeight: 600,
    color: '#333',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  },
  card: {
    padding: 16,
    marginBottom: 12,
    border: '1px solid #ddd',
    borderRadius: 6,
    background: '#fafafa',
  },
  stat: {
    margin: '4px 0',
    fontSize: 15,
  },
  statValue: {
    fontWeight: 700,
    fontSize: 16,
  },
  questionText: {
    margin: '0 0 8px',
    fontWeight: 500,
    fontSize: 14,
    color: '#222',
  },
  rollup: {
    margin: 0,
    fontSize: 14,
    color: '#444',
  },
  muted: {
    padding: '32px 16px',
    textAlign: 'center' as const,
    color: '#666',
    fontFamily: 'sans-serif',
  },
  errorText: {
    padding: '16px',
    color: '#c00',
    fontFamily: 'sans-serif',
  },
};
