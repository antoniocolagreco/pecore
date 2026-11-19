import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup as BaseRadioGroup } from "@base-ui/react/radio-group";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { useId } from "react";
import type { ReactNode } from "react";
import s from "./choice.module.css";

type Toggle = {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  label: ReactNode;
  detail?: ReactNode;
};

function Text({ label, detail }: { label: ReactNode; detail?: ReactNode }) {
  return (
    <span className={s.optionText}>
      <span>{label}</span>
      {detail && <span className={s.optionDetail}>{detail}</span>}
    </span>
  );
}

export function Checkbox({ label, detail, indeterminate, ...props }: Toggle & { indeterminate?: boolean }) {
  return (
    <label className={s.option} data-disabled={props.disabled ? "" : undefined}>
      <BaseCheckbox.Root className={s.box} indeterminate={indeterminate} {...props}>
        <BaseCheckbox.Indicator className={s.check} keepMounted>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={indeterminate ? "M3 6h6" : "m2.5 6.25 2.25 2.25L9.5 3.5"} pathLength={16} />
          </svg>
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
      <Text label={label} detail={detail} />
    </label>
  );
}

export function RadioGroup({
  label, options, value, defaultValue, onValueChange, disabled,
}: {
  label?: ReactNode;
  options: { value: string; label: ReactNode; detail?: ReactNode; disabled?: boolean }[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <BaseRadioGroup
      className={s.group}
      aria-labelledby={label ? id : undefined}
      value={value}
      defaultValue={defaultValue}
      onValueChange={(next) => onValueChange?.(next as string)}
      disabled={disabled}
    >
      {label && <div id={id} className={s.groupLabel}>{label}</div>}
      {options.map((o) => (
        <label key={o.value} className={s.option} data-disabled={disabled || o.disabled ? "" : undefined}>
          <Radio.Root value={o.value} className={`${s.box} ${s.radio}`} disabled={o.disabled}>
            <span className={s.dot} />
          </Radio.Root>
          <Text label={o.label} detail={o.detail} />
        </label>
      ))}
    </BaseRadioGroup>
  );
}

export function Switch({ label, detail, ...props }: Toggle) {
  return (
    <label className={s.switchRow}>
      <Text label={label} detail={detail} />
      <BaseSwitch.Root className={s.switch} {...props}>
        <BaseSwitch.Thumb className={s.thumb} />
      </BaseSwitch.Root>
    </label>
  );
}
