import React, { useCallback, useEffect, useState } from 'react';
import { ApiError, getActiveSurvey, submitResponse } from './api';
import type { ActiveSurvey, AnswerPayload } from './types';

/**
 * Member survey submission screen.
 *
 * Flow:
 *   1. On mount: fetch GET /surveys/active.
 *   2. Render each question with appropriate input controls.
 *   3. Submit button is disabled until every question has an answer.
 *   4. On POST success (201): show confirmation and freeze the form.
 *   5. On 409: show "already submitted" message.
 *   6. On other errors: show the error message.
 */
export function MemberScreen(): React.JSX.Element {
  const [survey, setSurvey] = useState<ActiveSurvey | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Map from questionId → chosen answer value
  const [answers, setAnswers] = useState<Map<string, number | boolean>>(new Map());

  const [submitting, setSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [submitMessage, setSubmitMessage] = useState<string>('');

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    getActiveSurvey()
      .then((s) => {
        setSurvey(s);
        setAnswers(new Map());
        setSubmitStatus('idle');
        setSubmitMessage('');
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : 'Failed to load survey');
      })
      .finally(() => setLoading(false));
  }, []);

  const setAnswer = useCallback(
    (questionId: string, value: number | boolean) => {
      setAnswers((prev) => new Map(prev).set(questionId, value));
    },
    [],
  );

  const allAnswered =
    survey !== null && survey.questions.every((q) => answers.has(q.id));

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!survey || !allAnswered || submitting) return;

    setSubmitting(true);
    setSubmitStatus('idle');
    setSubmitMessage('');

    const payload: AnswerPayload[] = survey.questions.map((q) => {
      const val = answers.get(q.id);
      if (q.type === 'RATING') {
        return { questionId: q.id, ratingValue: val as number };
      } else {
        return { questionId: q.id, yesNoValue: val as boolean };
      }
    });

    try {
      await submitResponse(survey.id, payload);
      setSubmitStatus('success');
      setSubmitMessage('Response submitted successfully.');
    } catch (err: unknown) {
      setSubmitStatus('error');
      if (err instanceof ApiError && err.status === 409) {
        setSubmitMessage('You have already submitted this week.');
      } else {
        setSubmitMessage(err instanceof Error ? err.message : 'Submission failed.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <p style={styles.info}>Loading survey…</p>;
  }

  if (loadError) {
    return <p style={styles.error}>Error: {loadError}</p>;
  }

  if (!survey) {
    return <p style={styles.info}>No active survey found for your organization.</p>;
  }

  const formDisabled = submitStatus === 'success' || submitting;

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>{survey.title}</h2>

      <form onSubmit={(e) => void handleSubmit(e)}>
        {survey.questions.map((q, idx) => (
          <div key={q.id} style={styles.questionBlock}>
            <p style={styles.questionText}>
              {idx + 1}. {q.text}
            </p>

            {q.type === 'RATING' && (
              <div style={styles.buttonRow}>
                {([1, 2, 3, 4, 5] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={formDisabled}
                    onClick={() => setAnswer(q.id, n)}
                    style={{
                      ...styles.answerBtn,
                      ...(answers.get(q.id) === n ? styles.answerBtnSelected : {}),
                    }}
                    aria-pressed={answers.get(q.id) === n}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}

            {q.type === 'YES_NO' && (
              <div style={styles.buttonRow}>
                {([true, false] as const).map((val) => (
                  <button
                    key={String(val)}
                    type="button"
                    disabled={formDisabled}
                    onClick={() => setAnswer(q.id, val)}
                    style={{
                      ...styles.answerBtn,
                      ...(answers.get(q.id) === val ? styles.answerBtnSelected : {}),
                    }}
                    aria-pressed={answers.get(q.id) === val}
                  >
                    {val ? 'Yes' : 'No'}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        <button
          type="submit"
          disabled={!allAnswered || formDisabled}
          style={{
            ...styles.submitBtn,
            ...(!allAnswered || formDisabled ? styles.submitBtnDisabled : {}),
          }}
        >
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </form>

      {submitStatus === 'success' && (
        <p style={styles.success}>{submitMessage}</p>
      )}
      {submitStatus === 'error' && (
        <p style={styles.error}>{submitMessage}</p>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 600,
    margin: '24px auto',
    padding: '0 16px',
    fontFamily: 'sans-serif',
  },
  title: {
    marginBottom: 24,
    fontSize: 20,
    fontWeight: 600,
  },
  questionBlock: {
    marginBottom: 24,
    padding: 16,
    border: '1px solid #ddd',
    borderRadius: 6,
    background: '#fafafa',
  },
  questionText: {
    margin: '0 0 12px',
    fontWeight: 500,
  },
  buttonRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  answerBtn: {
    padding: '8px 18px',
    border: '1px solid #aaa',
    borderRadius: 4,
    background: '#fff',
    cursor: 'pointer',
    fontSize: 14,
    minWidth: 44,
  },
  answerBtnSelected: {
    background: '#1a1a2e',
    color: '#fff',
    borderColor: '#1a1a2e',
  },
  submitBtn: {
    padding: '10px 28px',
    fontSize: 15,
    fontWeight: 600,
    border: 'none',
    borderRadius: 4,
    background: '#1a1a2e',
    color: '#fff',
    cursor: 'pointer',
    marginTop: 8,
  },
  submitBtnDisabled: {
    background: '#aaa',
    cursor: 'not-allowed',
  },
  success: {
    marginTop: 16,
    color: '#197a1f',
    fontWeight: 500,
  },
  error: {
    marginTop: 16,
    color: '#c00',
    fontWeight: 500,
  },
  info: {
    padding: '24px 16px',
    color: '#555',
  },
};
