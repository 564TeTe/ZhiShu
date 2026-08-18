import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Lock, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import AuthErrorAlert from './AuthErrorAlert';
import AuthInputField from './AuthInputField';
import AuthScreenLayout from './AuthScreenLayout';

type LoginFormState = {
  username: string;
  password: string;
};

const REMEMBERED_USERNAME_STORAGE_KEY = 'auth-remembered-username';

function readRememberedUsername(): string {
  try {
    return localStorage.getItem(REMEMBERED_USERNAME_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function persistRememberedUsername(username: string, shouldRemember: boolean) {
  try {
    if (shouldRemember) {
      localStorage.setItem(REMEMBERED_USERNAME_STORAGE_KEY, username);
      return;
    }

    localStorage.removeItem(REMEMBERED_USERNAME_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private browsing or restricted webviews.
  }
}

/**
 * Login form component.
 * Handles credential input with browser autofill support (`autocomplete`
 * attributes) so that password managers can offer to fill saved credentials.
 */
export default function LoginForm() {
  const { t } = useTranslation('auth');
  const { error: sessionError, login } = useAuth();

  const [formState, setFormState] = useState<LoginFormState>(() => ({
    username: readRememberedUsername(),
    password: '',
  }));
  const [shouldRememberUsername, setShouldRememberUsername] = useState(
    () => Boolean(readRememberedUsername()),
  );
  const [errorMessage, setErrorMessage] = useState('');
  const [helpMessage, setHelpMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateField = useCallback((field: keyof LoginFormState, value: string) => {
    setFormState((previous) => ({ ...previous, [field]: value }));
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setErrorMessage('');

      // Keep form validation local so each auth screen owns its own UI feedback.
      if (!formState.username.trim()) {
        setErrorMessage('请输入用户名。');
        return;
      }

      persistRememberedUsername(formState.username.trim(), shouldRememberUsername);
      setIsSubmitting(true);
      const result = await login(formState.username.trim(), formState.password);
      if (!result.success) {
        setErrorMessage(result.error);
      }
      setIsSubmitting(false);
    },
    [formState.password, formState.username, login, shouldRememberUsername],
  );

  return (
    <AuthScreenLayout
      title={t('login.title')}
      description={t('login.description')}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <AuthInputField
          id="username"
          label={t('login.username')}
          value={formState.username}
          onChange={(value) => updateField('username', value)}
          placeholder={t('login.placeholders.username')}
          isDisabled={isSubmitting}
          autoComplete="username"
          icon={User}
        />

        <AuthInputField
          id="password"
          label={t('login.password')}
          value={formState.password}
          onChange={(value) => updateField('password', value)}
          placeholder={t('login.placeholders.password')}
          isDisabled={isSubmitting}
          type="password"
          autoComplete="current-password"
          icon={Lock}
        />

        <div className="flex min-h-6 items-center justify-between gap-4 text-sm">
          <label className="flex cursor-pointer items-center gap-2 text-[#55595c]">
            <input
              type="checkbox"
              checked={shouldRememberUsername}
              onChange={(event) => setShouldRememberUsername(event.target.checked)}
              disabled={isSubmitting}
              className="h-4 w-4 rounded border-[#c9c9c6] accent-[#e85d1f] focus:ring-[#e85d1f]/30"
              style={{ accentColor: '#e85d1f' }}
            />
            {t('login.rememberMe')}
          </label>
          <button
            type="button"
            onClick={() => setHelpMessage(t('login.forgotPasswordHint'))}
            className="shrink-0 text-[#e85d1f] hover:text-[#c94b15] focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e85d1f]/30"
          >
            {t('login.forgotPassword')}
          </button>
        </div>

        {helpMessage && (
          <p role="status" className="rounded-lg bg-[#f7f3ef] px-3 py-2.5 text-sm leading-5 text-[#6f7477]">
            {helpMessage}
          </p>
        )}

        <AuthErrorAlert errorMessage={errorMessage || sessionError || ''} />

        <button
          type="submit"
          disabled={isSubmitting}
          className="flex h-[52px] w-full items-center justify-center gap-2 rounded-lg bg-[#e85d1f] px-4 font-medium text-white shadow-[0_8px_18px_rgba(232,93,31,0.20)] transition-colors hover:bg-[#d95218] focus:outline-none focus:ring-2 focus:ring-[#e85d1f]/35 focus:ring-offset-2 active:bg-[#c94b15] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('login.loading')}
            </>
          ) : (
            t('login.submit')
          )}
        </button>
      </form>
    </AuthScreenLayout>
  );
}
