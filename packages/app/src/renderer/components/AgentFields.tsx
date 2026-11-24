import { assistantTraits, incompatibleTraits } from "@pecore/schemas";
import type { Account, AssistantTraitId, BuiltInHarness } from "@pecore/schemas";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { IconButton } from "../ds/button";
import { Chip, Chips } from "../ds/choice";
import { Spinner } from "../ds/feedback";
import { TextField } from "../ds/field";
import { RefreshIcon } from "../ds/icons";
import { Tooltip } from "../ds/overlay";
import { Combobox, Select } from "../ds/select";
import { install } from "../shell/SetupBanner";
import s from "../screens/Settings.module.css";

export function harnessName(account: Account, all: Account[]): string {
  if (account.kind !== "model") return account.id;
  const name: string = install[account.connector as BuiltInHarness]?.name ?? account.connector;
  return all.filter((other) => other.kind === "model" && other.connector === account.connector).length > 1 ? `${name} · ${account.id}` : name;
}

type ModelChoice = { account: string; model: string; effort: string | null };
const inheritValue = "_inherit";

export function ModelPicker({ accounts, choice, onChoice, disabled, inherit }: { accounts: Account[]; choice: ModelChoice | null; onChoice(choice: ModelChoice | null): void; disabled: boolean; inherit?: string }) {
  const account: string = choice?.account ?? "";
  const model: string = choice?.model ?? "";
  const options = useData(() => account ? call("accountOptions", { params: { id: account }, query: {} }) : Promise.resolve(null), [account]);
  const offered = useData(() => account && model ? call("accountOptions", { params: { id: account }, query: { model } }) : Promise.resolve(null), [account, model]);
  const refresh = useAction(async () => {
    await call("refreshAccountOptions", { params: { id: account } });
    options.reload();
    offered.reload();
  });
  const models: string[] = [...new Set([...(options.data?.models ?? []), ...(model ? [model] : [])])];
  const efforts: string[] = [...new Set([...(offered.data?.efforts ?? []).filter((effort) => effort !== "default"), ...(choice?.effort ? [choice.effort] : [])])];
  const loading: boolean = !!account && (options.loading || refresh.busy);
  const readingEfforts: boolean = !!model && (offered.loading || refresh.busy);
  const current: Account | undefined = accounts.find(({ id }) => id === account);
  return <div className={s.modelGrid}>
    <Select label="Provider" value={account || (inherit ? inheritValue : null)} disabled={disabled} placeholder="Choose a provider"
      onValueChange={(next) => {
        if (next === inheritValue) onChoice(null);
        else if (next && next !== account) onChoice({ account: next, model: "", effort: null });
      }}
      options={[...(inherit ? [{ value: inheritValue, label: inherit }] : []), ...accounts.map((item) => ({ value: item.id, label: harnessName(item, accounts) }))]} />
    <div className={s.withButton}>
      {loading
        ? <TextField label="Model" leading={<Spinner />} value="" placeholder={`Reading models from ${current ? harnessName(current, accounts) : account}…`} readOnly />
        : <Combobox label="Model" value={choice?.model || null} disabled={disabled || !account} placeholder="Choose a model"
          onValueChange={(next) => { if (choice && next && next !== model) onChoice({ ...choice, model: next, effort: null }); }}
          options={models.map((model) => ({ value: model, label: model }))} />}
      <IconButton label="Read the models again" icon={<RefreshIcon />} disabled={disabled || !account || loading} onClick={() => void refresh.run()} />
    </div>
    {loading || readingEfforts
      ? <TextField label="Effort" leading={<Spinner />} value="" placeholder="Reading…" readOnly />
      : <Select label="Effort" value={choice?.effort ?? "default"} disabled={disabled || !choice?.model}
        onValueChange={(effort) => { if (choice) onChoice({ ...choice, effort: !effort || effort === "default" ? null : effort }); }}
        options={[{ value: "default", label: "Default" }, ...efforts.map((effort) => ({ value: effort, label: effort }))]} />}
  </div>;
}

export function Traits({ value, disabled, onChange }: { value: AssistantTraitId[]; disabled: boolean; onChange(traits: AssistantTraitId[]): void }) {
  return (
    <div>
      <span className={s.label}>Personality</span>
      <div className={s.traits}>
        <Chips label="Personality">
          {assistantTraits.map(({ id, label, description }) => {
            const on: boolean = value.includes(id);
            const blocked: string[] = on ? [] : incompatibleTraits[id].filter((other) => value.includes(other)).map((other) => assistantTraits.find((trait) => trait.id === other)!.label);
            return (
              <Tooltip key={id} delay={0} side="top" content={blocked.length ? `${description} Does not go with ${blocked.join(" or ")}.` : description}>
                <Chip pressed={on} aria-disabled={disabled || blocked.length > 0}
                  onClick={() => { if (!disabled && !blocked.length) onChange(on ? value.filter((trait) => trait !== id) : [...value, id]); }}>
                  {label}
                </Chip>
              </Tooltip>
            );
          })}
        </Chips>
      </div>
    </div>
  );
}
