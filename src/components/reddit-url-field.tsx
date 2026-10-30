'use client';

import { useId, useState } from 'react';
import { Check, TriangleAlert } from 'lucide-react';
import { parseRedditProfileUrl } from '@/lib/reddit-url';
import { useFormState } from './forms';

/**
 * Live feedback while typing. The server parses the link again on submit; this only helps people
 * spot a typo early and shows the username we extracted from whatever shape of link they pasted.
 */
export function RedditUrlField() {
  const st = useFormState();
  const id = useId();
  const [value, setValue] = useState(st.values?.profileUrl ?? '');
  const serverError = st.fieldErrors?.profileUrl;
  const parsed = value.trim() ? parseRedditProfileUrl(value) : null;
  return (
    <div>
      <label htmlFor={id} className="label">Reddit profile link</label>
      <input
        id={id} name="profileUrl" className="input" inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false}
        placeholder="https://www.reddit.com/user/yourname/" required value={value} onChange={(e) => setValue(e.target.value)}
        aria-invalid={serverError ? true : undefined} aria-describedby={`${id}-help`}
      />
      <div id={`${id}-help`} aria-live="polite">
        {serverError ? (
          <p className="field-error">{serverError}</p>
        ) : parsed?.ok ? (
          <p className="mt-1.5 flex items-start gap-1.5 text-sm text-ok"><Check className="mt-0.5 size-4 flex-none" aria-hidden /><span>We&apos;ll check <strong>u/{parsed.username}</strong> <span className="text-muted">({parsed.canonicalUrl})</span></span></p>
        ) : parsed ? (
          <p className="mt-1.5 flex items-start gap-1.5 text-sm text-bad"><TriangleAlert className="mt-0.5 size-4 flex-none" aria-hidden /><span>{parsed.error}</span></p>
        ) : (
          <p className="hint">Paste the link to your profile. Shortcuts like u/yourname also work.</p>
        )}
      </div>
    </div>
  );
}
