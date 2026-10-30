'use client';

import { createContext, useActionState, useContext, useId, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { CircleCheck, Eye, EyeOff, OctagonAlert } from 'lucide-react';
import type { ActionState } from '@/server/action';

const FormCtx = createContext<ActionState>({});

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * Wraps a server action. Shows the result banner, keeps what the person typed after an error
 * (React clears uncontrolled inputs after every action, so values come back via state), and
 * hands per-field errors to the <Field> components inside it.
 */
export function ActionForm({
  action,
  children,
  className = 'space-y-4',
  showSuccess = true,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  showSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, {} as ActionState);
  return (
    <FormCtx.Provider value={state}>
      <form action={formAction} className={className}>
        {state.error && (
          <div className="banner banner-bad" role="alert">
            <OctagonAlert className="size-5" aria-hidden />
            <p>{state.error}</p>
          </div>
        )}
        {showSuccess && state.ok && state.message && (
          <div className="banner banner-ok" role="status">
            <CircleCheck className="size-5" aria-hidden />
            <p>{state.message}</p>
          </div>
        )}
        {children}
        {state.data?.devLink && (
          <div className="banner banner-warn" role="status">
            <div>
              <p className="font-semibold">Development mode: email is not configured</p>
              <p className="mt-1 break-all">
                Use this link instead of the email: <a href={state.data.devLink}>{state.data.devLink}</a>
              </p>
            </div>
          </div>
        )}
      </form>
    </FormCtx.Provider>
  );
}

interface BaseProps {
  name: string;
  label: string;
  hint?: ReactNode;
  required?: boolean;
  defaultValue?: string | number | null;
}

function useField(name: string, defaultValue: BaseProps['defaultValue']) {
  const state = useContext(FormCtx);
  const id = useId();
  const error = state.fieldErrors?.[name];
  const value = state.values?.[name] ?? (defaultValue === null || defaultValue === undefined ? '' : String(defaultValue));
  return { id, error, value, ariaProps: { 'aria-invalid': error ? (true as const) : undefined, 'aria-describedby': error ? `${id}-err` : undefined } };
}

function Shell({ id, label, hint, error, children }: { id: string; label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      {children}
      {hint && !error && <p className="hint">{hint}</p>}
      {error && <p id={`${id}-err`} className="field-error">{error}</p>}
    </div>
  );
}

export function Field({
  name, label, hint, required, defaultValue, type = 'text', autoComplete, placeholder, inputMode, maxLength, min, step, disabled,
}: BaseProps & { type?: string; autoComplete?: string; placeholder?: string; inputMode?: 'text' | 'numeric' | 'decimal' | 'email' | 'url'; maxLength?: number; min?: number; step?: string; disabled?: boolean }) {
  const f = useField(name, defaultValue);
  return (
    <Shell id={f.id} label={label} hint={hint} error={f.error}>
      <input id={f.id} name={name} type={type} className="input" required={required} defaultValue={f.value} key={f.value}
        autoComplete={autoComplete} placeholder={placeholder} inputMode={inputMode} maxLength={maxLength} min={min} step={step} disabled={disabled}
        autoCapitalize="none" spellCheck={false} {...f.ariaProps} />
    </Shell>
  );
}

export function PasswordField({ name, label, hint, autoComplete = 'current-password', required = true }: Omit<BaseProps, 'defaultValue'> & { autoComplete?: string }) {
  const f = useField(name, '');
  const [show, setShow] = useState(false);
  return (
    <Shell id={f.id} label={label} hint={hint} error={f.error}>
      <div className="relative">
        <input id={f.id} name={name} type={show ? 'text' : 'password'} className="input pr-12" required={required} autoComplete={autoComplete}
          autoCapitalize="none" spellCheck={false} {...f.ariaProps} />
        <button type="button" onClick={() => setShow((s) => !s)} aria-pressed={show}
          className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-muted hover:text-ink"
          aria-label={show ? 'Hide password' : 'Show password'}>
          {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
        </button>
      </div>
    </Shell>
  );
}

export function TextArea({ name, label, hint, required, defaultValue, rows = 4, maxLength, placeholder }: BaseProps & { rows?: number; maxLength?: number; placeholder?: string }) {
  const f = useField(name, defaultValue);
  return (
    <Shell id={f.id} label={label} hint={hint} error={f.error}>
      <textarea id={f.id} name={name} className="input" rows={rows} required={required} defaultValue={f.value} key={f.value} maxLength={maxLength} placeholder={placeholder} {...f.ariaProps} />
    </Shell>
  );
}

export function SelectField({ name, label, hint, required, defaultValue, options }: BaseProps & { options: { value: string; label: string }[] }) {
  const f = useField(name, defaultValue);
  return (
    <Shell id={f.id} label={label} hint={hint} error={f.error}>
      <select id={f.id} name={name} className="input" required={required} defaultValue={f.value} key={f.value} {...f.ariaProps}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Shell>
  );
}

export function CheckField({ name, label, hint, defaultChecked }: { name: string; label: ReactNode; hint?: ReactNode; defaultChecked?: boolean }) {
  const state = useContext(FormCtx);
  const id = useId();
  const error = state.fieldErrors?.[name];
  const checked = state.values ? state.values[name] === 'on' : defaultChecked;
  return (
    <div>
      <div className="check">
        <input id={id} name={name} type="checkbox" defaultChecked={checked} key={String(checked)} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-err` : undefined} />
        <label htmlFor={id}>
          {label}
          {hint && <span className="hint block">{hint}</span>}
        </label>
      </div>
      {error && <p id={`${id}-err`} className="field-error ml-8">{error}</p>}
    </div>
  );
}

export function SubmitButton({
  children, pendingLabel, className = 'btn btn-primary', confirm, name, value,
}: { children: ReactNode; pendingLabel?: string; className?: string; confirm?: string; name?: string; value?: string }) {
  const { pending, data } = useFormStatus();
  // In a form with several submit buttons, only the one that was pressed shows the spinner.
  const mine = pending && (!name || data?.get(name) === value);
  return (
    <button type="submit" name={name} value={value} className={className} disabled={pending} aria-busy={mine}
      onClick={confirm ? (e) => { if (!window.confirm(confirm)) e.preventDefault(); } : undefined}>
      {mine && <span className="spinner" aria-hidden />}
      {mine && pendingLabel ? pendingLabel : children}
    </button>
  );
}

/** Shown under a form only after it succeeded in development mode (when email is not configured). */
export function DevContinue({ href, children }: { href: string; children: ReactNode }) {
  const s = useContext(FormCtx);
  if (!s.ok || !s.data?.devLink) return null;
  return <p className="text-center"><a href={href} className="font-semibold">{children}</a></p>;
}

/** Lets custom client inputs read the surrounding form's result (field errors and echoed values). */
export function useFormState(): ActionState {
  return useContext(FormCtx);
}
