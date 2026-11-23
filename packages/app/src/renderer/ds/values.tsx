import { Field } from "@base-ui/react/field";
import { NumberField as BaseNumberField } from "@base-ui/react/number-field";
import { Slider as BaseSlider } from "@base-ui/react/slider";
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { FieldFrame } from "./field";
import type { FieldProps } from "./field";
import f from "./field.module.css";
import { ChevronDownIcon, ChevronUpIcon } from "./icons";
import s from "./values.module.css";

export function NumberField({
  label, labelAction, description, error, disabled, className, value, defaultValue, onValueChange, min, max, step = 1, unit, fullWidth, placeholder,
}: FieldProps & {
  fullWidth?: boolean;
  placeholder?: string;
  value?: number | null;
  defaultValue?: number;
  onValueChange?: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  return (
    <FieldFrame description={description} error={error} disabled={disabled} className={className}>
      <BaseNumberField.Root
        value={value}
        defaultValue={defaultValue}
        onValueChange={(next) => onValueChange?.(next)}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className={f.field}
      >
        {label && (
          <div className={f.labelRow}>
            <BaseNumberField.ScrubArea className={s.scrub}>
              <Field.Label className={s.label}>{label}</Field.Label>
              <BaseNumberField.ScrubAreaCursor className={s.scrubCursor}>
                <svg width="24" height="14" viewBox="0 0 24 14" fill="currentColor" stroke="var(--bg)" aria-hidden>
                  <path d="M19.5 5.5 6.5 5.52V2L1 7l5.5 5-.003-3.5H19.5V12L25 7l-5.5-5v3.5Z" />
                </svg>
              </BaseNumberField.ScrubAreaCursor>
            </BaseNumberField.ScrubArea>
            {labelAction}
          </div>
        )}
        <BaseNumberField.Group className={`${f.shell} ${s.numberGroup} ${fullWidth ? s.fullWidth : ""}`}>
          <BaseNumberField.Input className={`${f.input} ${s.numberInput}`} placeholder={placeholder} />
          {unit && <span className={s.unit}>{unit}</span>}
          <span className={s.stepper}>
            <BaseNumberField.Increment className={s.step} aria-label="Increase"><ChevronUpIcon size="xs" bold /></BaseNumberField.Increment>
            <BaseNumberField.Decrement className={s.step} aria-label="Decrease"><ChevronDownIcon size="xs" bold /></BaseNumberField.Decrement>
          </span>
        </BaseNumberField.Group>
      </BaseNumberField.Root>
    </FieldFrame>
  );
}

export function Slider({
  label, value, defaultValue, onValueChange, min = 0, max = 100, step = 1, disabled, format, ticks,
}: {
  label?: ReactNode;
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  format?: (value: number) => string;
  ticks?: string[];
}) {
  const [own, setOwn] = useState(defaultValue ?? min);
  const current = value ?? own;
  return (
    <BaseSlider.Root
      className={s.slider}
      value={current}
      onValueChange={(next) => {
        const n = next as number;
        if (value === undefined) setOwn(n);
        onValueChange?.(n);
      }}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
    >
      {label && (
        <div className={s.sliderHead}>
          <span className={s.label}>{label}</span>
          <span className={s.sliderValue}>{format ? format(current) : current}</span>
        </div>
      )}
      <BaseSlider.Control className={s.control}>
        <BaseSlider.Track className={s.track}>
          <BaseSlider.Indicator className={s.indicator} />
          <BaseSlider.Thumb className={s.thumb} aria-label={typeof label === "string" ? label : undefined} />
        </BaseSlider.Track>
      </BaseSlider.Control>
      {ticks && (
        <div className={s.ticks}>
          {ticks.map((t) => <span key={t}>{t}</span>)}
        </div>
      )}
    </BaseSlider.Root>
  );
}

export function Segmented({
  options, value, defaultValue, onValueChange, label,
}: {
  options: { value: string; label: ReactNode }[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  label?: string;
}) {
  const [own, setOwn] = useState(defaultValue ?? options[0]?.value ?? "");
  const current = value ?? own;
  const root = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const measure = () => {
      const el = root.current?.querySelector<HTMLElement>("[data-pressed]");
      if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (root.current) observer.observe(root.current);
    const frame = requestAnimationFrame(() => setReady(true));
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [current]);
  return (
    <ToggleGroup
      ref={root}
      className={s.segmented}
      value={[current]}
      aria-label={label}
      onValueChange={(next) => {
        const picked = next[0];
        if (!picked) return;
        if (value === undefined) setOwn(picked);
        onValueChange?.(picked);
      }}
    >
      {pill && <span className={s.pill} style={{ translate: `${pill.x}px 0`, width: pill.w, transition: ready ? undefined : "none" }} aria-hidden />}
      {options.map((o) => (
        <Toggle key={o.value} value={o.value} className={s.segment}>
          {o.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
