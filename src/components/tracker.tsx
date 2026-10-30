import type { SubmissionRow } from '@/services/types';
import { fmtDateTime, SOURCE_LABEL } from './ui';

type StepState = 'done' | 'current' | 'todo' | 'bad';

/** The application timeline, drawn as a thread: each node is a real stage of the review process. */
export function ApplicationTracker({ s }: { s: SubmissionRow }) {
  const decided = ['Approved', 'Rejected', 'Suspended'].includes(s.status);
  const reviewing = ['Pending Admin Review', 'Needs More Information'].includes(s.status);
  const check =
    s.status === 'Pending Verification'
      ? 'Retrieving your account details from Reddit…'
      : s.verification_state === 'verified'
        ? `Account details recorded. ${s.values_source ? SOURCE_LABEL[s.values_source] : ''}`.trim() + '.'
        : s.verification_state === 'manual_review_required'
          ? 'Could not be completed automatically. An administrator will verify it manually.'
          : 'Could not be verified automatically. An administrator will look at it.';
  const steps: { title: string; body: string; state: StepState }[] = [
    { title: 'Application submitted', body: fmtDateTime(s.submitted_at), state: 'done' },
    { title: 'Reddit account check', body: check, state: s.status === 'Pending Verification' ? 'current' : 'done' },
    {
      title: s.status === 'Needs More Information' ? 'Administrator needs more information' : 'Administrator review',
      body: reviewing ? 'Required before you can access tasks.' : decided ? 'Completed.' : 'Starts after the account check.',
      state: reviewing ? 'current' : decided ? 'done' : 'todo',
    },
    {
      title: s.status === 'Rejected' ? 'Not approved' : s.status === 'Suspended' ? 'Access suspended' : 'Approved',
      body: decided ? fmtDateTime(s.decided_at) : 'The administrator makes the final decision.',
      state: s.status === 'Approved' ? 'done' : s.status === 'Rejected' || s.status === 'Suspended' ? 'bad' : 'todo',
    },
  ];
  return (
    <ol className="thread" aria-label="Application progress">
      {steps.map((st, i) => (
        <li key={st.title} data-state={st.state}>
          <span className="thread-node" aria-hidden>{st.state === 'done' ? '✓' : st.state === 'bad' ? '!' : i + 1}</span>
          <p className="font-semibold leading-snug">{st.title}<span className="sr-only"> ({st.state === 'todo' ? 'not started' : st.state === 'bad' ? 'stopped' : st.state})</span></p>
          <p className="text-[0.95rem] text-muted">{st.body}</p>
        </li>
      ))}
    </ol>
  );
}

export function statusHeadline(status: string): string {
  switch (status) {
    case 'Pending Verification': return 'We are checking your Reddit account';
    case 'Pending Admin Review': return 'Waiting for administrator review';
    case 'Needs More Information': return 'The administrator needs more information';
    case 'Approved': return 'You are approved';
    case 'Rejected': return 'Your application was not approved';
    case 'Suspended': return 'Your task access is suspended';
    default: return 'Submit your Reddit account to get started';
  }
}
