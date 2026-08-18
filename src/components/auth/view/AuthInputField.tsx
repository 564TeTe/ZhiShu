import { useState } from 'react';
import type { ComponentType } from 'react';
import { Eye, EyeOff } from 'lucide-react';

type AuthInputFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (nextValue: string) => void;
  placeholder: string;
  isDisabled: boolean;
  type?: 'text' | 'password' | 'email';
  name?: string;
  autoComplete?: string;
  icon?: ComponentType<{ className?: string }>;
};

/**
 * A labelled input field for authentication forms.
 * Renders a `<label>` / `<input>` pair and forwards browser autofill hints
 * (`name`, `autoComplete`) so that password managers can identify and fill
 * the field correctly. Password fields gain a show/hide visibility toggle.
 */
export default function AuthInputField({
  id,
  label,
  value,
  onChange,
  placeholder,
  isDisabled,
  type = 'text',
  name,
  autoComplete,
  icon: Icon,
}: AuthInputFieldProps) {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  const isPasswordField = type === 'password';
  const resolvedType = isPasswordField && isPasswordVisible ? 'text' : type;

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="group relative">
        {Icon && (
          <Icon className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#9da0a2] transition-colors group-focus-within:text-[#e85d1f]" />
        )}
        <input
          id={id}
          type={resolvedType}
          name={name ?? id}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`h-14 w-full rounded-lg border border-[#d7d7d4] bg-white/75 text-[15px] text-[#303438] shadow-sm transition-colors placeholder:text-[#b4b6b7] hover:border-[#bdbebb] focus:border-[#e85d1f] focus:outline-none focus:ring-2 focus:ring-[#e85d1f]/15 disabled:cursor-not-allowed disabled:opacity-60 ${
            Icon ? 'pl-12' : 'pl-4'
          } ${isPasswordField ? 'pr-12' : 'pr-4'}`}
          placeholder={placeholder}
          disabled={isDisabled}
        />
        {isPasswordField && (
          <button
            type="button"
            onClick={() => setIsPasswordVisible((previous) => !previous)}
            disabled={isDisabled}
            aria-label={isPasswordVisible ? 'Hide password' : 'Show password'}
            className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-[#9da0a2] transition-colors hover:bg-[#f3f1ee] hover:text-[#55595c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e85d1f]/30 disabled:opacity-60"
          >
            {isPasswordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}
