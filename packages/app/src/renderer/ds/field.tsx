import { Field } from "@base-ui/react/field";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import s from "./field.module.css";
import { AlertIcon, EyeIcon, EyeOffIcon, SearchIcon, XIcon } from "./icons";

export type FieldProps = {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  disabled?: boolean;
  className?: string;
};

type TextProps = FieldProps & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  name?: string;
  required?: boolean;
  autoFocus?: boolean;
  readOnly?: boolean;
  size?: "sm" | "md";
  mono?: boolean;
};

function cx(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

function useText(props: { value?: string; defaultValue?: string; onValueChange?: (value: string) => void }): [string, (value: string) => void] {
  const [own, setOwn] = useState(props.defaultValue ?? "");
  const value = props.value ?? own;
  return [value, (next) => {
    if (props.value === undefined) setOwn(next);
    props.onValueChange?.(next);
  }];
}

export function FieldFrame({ label, description, error, disabled, className, footer, children }: FieldProps & { footer?: ReactNode; children: ReactNode }) {
  const shown = useRef<ReactNode>(error);
  if (error) shown.current = error;
  return (
    <Field.Root className={cx(s.field, className)} disabled={disabled} invalid={Boolean(error)}>
      {label && <Field.Label className={s.label}>{label}</Field.Label>}
      {children}
      <Field.Error className={s.error} match={Boolean(error)}>
        <AlertIcon size={13} />
        <span>{shown.current}</span>
      </Field.Error>
      {(description || footer) && (
        <div className={s.footer}>
          {description && <Field.Description className={s.description}>{description}</Field.Description>}
          {footer}
        </div>
      )}
    </Field.Root>
  );
}

export function TextField({ label, description, error, disabled, className, leading, prefix, suffix, size = "md", mono, ...input }: TextProps & { leading?: ReactNode; prefix?: string; suffix?: string; type?: "text" | "email" | "url" }) {
  const [value, setValue] = useText(input);
  return (
    <FieldFrame label={label} description={description} error={error} disabled={disabled} className={className}>
      <div className={cx(s.shell, size === "sm" && s.sm)}>
        {prefix && <span className={s.affix}>{prefix}</span>}
        {leading && <span className={s.leading}>{leading}</span>}
        <Field.Control
          className={cx(s.input, mono && s.mono)}
          type={input.type ?? "text"}
          value={value}
          onValueChange={(next) => setValue(String(next))}
          placeholder={input.placeholder}
          name={input.name}
          required={input.required}
          autoFocus={input.autoFocus}
          readOnly={input.readOnly}
          spellCheck={false}
        />
        {suffix && <span className={s.affix}>{suffix}</span>}
      </div>
    </FieldFrame>
  );
}

export function TextArea({ label, description, error, disabled, className, maxLength, mono, ...input }: TextProps & { maxLength?: number }) {
  const [value, setValue] = useText(input);
  const counter = maxLength === undefined ? undefined : (
    <span className={s.counter} data-over={value.length > maxLength ? "" : undefined}>{value.length} / {maxLength}</span>
  );
  return (
    <FieldFrame label={label} description={description} error={error} disabled={disabled} className={className} footer={counter}>
      <div className={s.shell}>
        <Field.Control
          render={<textarea />}
          className={cx(s.input, s.textarea, mono && s.mono)}
          value={value}
          onValueChange={(next) => setValue(String(next))}
          placeholder={input.placeholder}
          name={input.name}
          required={input.required}
          autoFocus={input.autoFocus}
        />
      </div>
    </FieldFrame>
  );
}

export function PasswordField({ label, description, error, disabled, className, ...input }: TextProps) {
  const [value, setValue] = useText(input);
  const [visible, setVisible] = useState(false);
  const [caps, setCaps] = useState(false);
  const track = (event: KeyboardEvent<HTMLInputElement>) => setCaps(event.getModifierState("CapsLock"));
  return (
    <FieldFrame
      label={label}
      description={description}
      error={error}
      disabled={disabled}
      className={className}
      footer={caps && <span className={s.hint}>Caps Lock is on</span>}
    >
      <div className={s.shell}>
        <Field.Control
          className={cx(s.input, visible && s.mono)}
          type={visible ? "text" : "password"}
          value={value}
          onValueChange={(next) => setValue(String(next))}
          onKeyDown={track}
          onKeyUp={track}
          onBlur={() => setCaps(false)}
          placeholder={input.placeholder}
          name={input.name}
          autoComplete="off"
          spellCheck={false}
        />
        <span className={s.trailing}>
          <button type="button" className={s.iconButton} disabled={disabled} onClick={() => setVisible((v) => !v)} aria-label={visible ? "Hide password" : "Show password"}>
            <span className={s.swap}>
              <EyeIcon data-off={visible ? "" : undefined} />
              <EyeOffIcon data-off={visible ? undefined : ""} />
            </span>
          </button>
        </span>
      </div>
    </FieldFrame>
  );
}

export function SearchField({ label, description, error, disabled, className, shortcut, size = "md", ...input }: TextProps & { shortcut?: string }) {
  const [value, setValue] = useText(input);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!shortcut) return;
    const key = shortcut.at(-1)!.toLowerCase();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === key) {
        event.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut]);
  return (
    <FieldFrame label={label} description={description} error={error} disabled={disabled} className={className}>
      <div className={cx(s.shell, size === "sm" && s.sm)}>
        <span className={s.leading}><SearchIcon size={15} /></span>
        <Field.Control
          ref={ref}
          className={s.input}
          type="text"
          role="searchbox"
          value={value}
          onValueChange={(next) => setValue(String(next))}
          onKeyDown={(event) => {
            if (event.key === "Escape" && value) {
              event.preventDefault();
              setValue("");
            }
          }}
          placeholder={input.placeholder ?? "Search"}
          spellCheck={false}
        />
        <span className={cx(s.trailing, s.stack)}>
          {shortcut && <kbd className={s.kbd} data-hidden={value ? "" : undefined}>{shortcut}</kbd>}
          <button
            type="button"
            className={cx(s.iconButton, s.clear)}
            data-hidden={value ? undefined : ""}
            tabIndex={value ? 0 : -1}
            onClick={() => {
              setValue("");
              ref.current?.focus();
            }}
            aria-label="Clear search"
          >
            <XIcon size={10} strokeWidth={2.4} />
          </button>
        </span>
      </div>
    </FieldFrame>
  );
}
