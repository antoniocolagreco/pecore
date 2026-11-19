import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import { Field } from "@base-ui/react/field";
import { Select as BaseSelect } from "@base-ui/react/select";
import type { ReactNode } from "react";
import { FieldFrame } from "./field";
import type { FieldProps } from "./field";
import f from "./field.module.css";
import { CheckIcon, ChevronDownIcon, ChevronUpDownIcon, ChevronUpIcon, XIcon } from "./icons";
import s from "./popup.module.css";

export type Option = { value: string; label: string; detail?: string; disabled?: boolean };
export type OptionGroup = { label: string; options: Option[] };

function isGroups(options: Option[] | OptionGroup[]): options is OptionGroup[] {
  return options.length > 0 && "options" in options[0]!;
}

function SelectItem({ option }: { option: Option }) {
  return (
    <BaseSelect.Item className={s.item} value={option.value} disabled={option.disabled}>
      <BaseSelect.ItemIndicator className={s.itemIndicator}>
        <CheckIcon size={14} strokeWidth={2} />
      </BaseSelect.ItemIndicator>
      <BaseSelect.ItemText className={s.itemText}>{option.label}</BaseSelect.ItemText>
      {option.detail && <span className={s.itemDetail}>{option.detail}</span>}
    </BaseSelect.Item>
  );
}

export function Select({
  label, description, error, disabled, className, options, value, defaultValue, onValueChange, placeholder = "Choose…", ariaLabel,
}: FieldProps & {
  options: Option[] | OptionGroup[];
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string | null) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const flat: Option[] = isGroups(options) ? options.flatMap((g) => g.options) : options;
  return (
    <FieldFrame label={label} description={description} error={error} disabled={disabled} className={className}>
      <BaseSelect.Root
        items={flat.map((o) => ({ value: o.value, label: o.label }))}
        value={value}
        defaultValue={defaultValue}
        onValueChange={(next) => onValueChange?.(next as string | null)}
        disabled={disabled}
      >
        <BaseSelect.Trigger className={s.trigger} aria-label={ariaLabel}>
          <BaseSelect.Value className={s.value} placeholder={placeholder} />
          <BaseSelect.Icon className={s.chevron}>
            <ChevronUpDownIcon size={12} strokeWidth={2} />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
        <BaseSelect.Portal>
          <BaseSelect.Positioner className={s.positioner} sideOffset={6}>
            <BaseSelect.Popup className={s.popup}>
              <BaseSelect.ScrollUpArrow className={s.scrollArrow}><ChevronUpIcon size={12} /></BaseSelect.ScrollUpArrow>
              <BaseSelect.List className={s.list}>
                {isGroups(options)
                  ? options.map((group, i) => (
                      <BaseSelect.Group key={group.label}>
                        {i > 0 && <BaseSelect.Separator className={s.separator} />}
                        <BaseSelect.GroupLabel className={s.groupLabel}>{group.label}</BaseSelect.GroupLabel>
                        {group.options.map((o) => <SelectItem key={o.value} option={o} />)}
                      </BaseSelect.Group>
                    ))
                  : options.map((o) => <SelectItem key={o.value} option={o} />)}
              </BaseSelect.List>
              <BaseSelect.ScrollDownArrow className={s.scrollArrow}><ChevronDownIcon size={12} /></BaseSelect.ScrollDownArrow>
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </BaseSelect.Portal>
      </BaseSelect.Root>
    </FieldFrame>
  );
}

function ComboPopup({ empty }: { empty: ReactNode }) {
  return (
    <BaseCombobox.Portal>
      <BaseCombobox.Positioner className={s.positioner} sideOffset={6}>
        <BaseCombobox.Popup className={s.popup}>
          <BaseCombobox.Empty className={s.empty}>{empty}</BaseCombobox.Empty>
          <BaseCombobox.List className={s.list}>
            {(option: Option) => (
              <BaseCombobox.Item key={option.value} value={option} className={s.item} disabled={option.disabled}>
                <BaseCombobox.ItemIndicator className={s.itemIndicator}>
                  <CheckIcon size={14} strokeWidth={2} />
                </BaseCombobox.ItemIndicator>
                <span className={s.itemText}>{option.label}</span>
                {option.detail && <span className={s.itemDetail}>{option.detail}</span>}
              </BaseCombobox.Item>
            )}
          </BaseCombobox.List>
        </BaseCombobox.Popup>
      </BaseCombobox.Positioner>
    </BaseCombobox.Portal>
  );
}

const comboItems = {
  itemToStringLabel: (o: Option) => o.label,
  itemToStringValue: (o: Option) => o.value,
  isItemEqualToValue: (a: Option, b: Option) => a.value === b.value,
};

export function Combobox({
  label, description, error, disabled, className, options, value, defaultValue, onValueChange, placeholder, empty = "No results",
}: FieldProps & {
  options: Option[];
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string | null) => void;
  placeholder?: string;
  empty?: ReactNode;
}) {
  const find = (v: string | null | undefined): Option | null | undefined => (v === undefined ? undefined : (options.find((o) => o.value === v) ?? null));
  return (
    <FieldFrame label={label} description={description} error={error} disabled={disabled} className={className}>
      <BaseCombobox.Root
        items={options}
        {...comboItems}
        value={find(value)}
        defaultValue={find(defaultValue)}
        onValueChange={(next) => onValueChange?.((next as Option | null)?.value ?? null)}
        disabled={disabled}
        autoHighlight
      >
        <BaseCombobox.InputGroup className={f.shell}>
          <BaseCombobox.Input render={<Field.Control />} className={f.input} placeholder={placeholder} spellCheck={false} />
          <span className={f.trailing}>
            <BaseCombobox.Clear className={`${f.iconButton} ${f.clear}`} aria-label="Clear">
              <XIcon size={10} strokeWidth={2.4} />
            </BaseCombobox.Clear>
            <BaseCombobox.Trigger className={f.iconButton} aria-label="Show options">
              <ChevronDownIcon size={14} />
            </BaseCombobox.Trigger>
          </span>
        </BaseCombobox.InputGroup>
        <ComboPopup empty={empty} />
      </BaseCombobox.Root>
    </FieldFrame>
  );
}

export function MultiCombobox({
  label, description, error, disabled, className, options, value, defaultValue, onValueChange, placeholder, empty = "No results",
}: FieldProps & {
  options: Option[];
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
  placeholder?: string;
  empty?: ReactNode;
}) {
  const find = (v: string[] | undefined): Option[] | undefined => v?.flatMap((x) => options.filter((o) => o.value === x));
  return (
    <FieldFrame label={label} description={description} error={error} disabled={disabled} className={className}>
      <BaseCombobox.Root
        items={options}
        {...comboItems}
        multiple
        value={find(value)}
        defaultValue={find(defaultValue)}
        onValueChange={(next) => onValueChange?.((next as Option[]).map((o) => o.value))}
        disabled={disabled}
        autoHighlight
      >
        <BaseCombobox.InputGroup className={f.shell}>
          <BaseCombobox.Value>
            {(selected: Option[]) => (
              <BaseCombobox.Chips className={s.chips} aria-label={selected.length ? "Selected" : undefined}>
                {selected.map((o) => (
                  <BaseCombobox.Chip key={o.value} className={s.chip} aria-label={o.label}>
                    {o.label}
                    <BaseCombobox.ChipRemove className={s.chipRemove} aria-label={`Remove ${o.label}`}>
                      <XIcon size={10} strokeWidth={2.2} />
                    </BaseCombobox.ChipRemove>
                  </BaseCombobox.Chip>
                ))}
                <BaseCombobox.Input render={<Field.Control />} className={s.chipInput} placeholder={selected.length ? "" : placeholder} spellCheck={false} />
              </BaseCombobox.Chips>
            )}
          </BaseCombobox.Value>
        </BaseCombobox.InputGroup>
        <ComboPopup empty={empty} />
      </BaseCombobox.Root>
    </FieldFrame>
  );
}
