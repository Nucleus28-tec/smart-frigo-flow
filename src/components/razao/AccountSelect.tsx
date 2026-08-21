"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type AccountOption = { reduced_code: string; name: string };

type AccountSelectProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  accounts: AccountOption[];
  tone: "debito" | "credito";
  placeholder?: string;
  disabled?: boolean;
};

function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function AccountSelect({
  id,
  value,
  onChange,
  accounts,
  tone,
  placeholder = "Buscar conta...",
  disabled,
}: AccountSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const selected = React.useMemo(
    () => accounts.find((a) => a.reduced_code === value) ?? null,
    [accounts, value],
  );

  const filtered = React.useMemo(() => {
    const term = normalize(search);
    if (!term) return accounts;
    return accounts.filter((a) => {
      const code = normalize(a.reduced_code);
      const name = normalize(a.name);
      return code.includes(term) || name.includes(term);
    });
  }, [accounts, search]);

  const toneClass =
    tone === "debito"
      ? "bg-warning/15 text-warning-foreground ring-warning/30"
      : "bg-brand-soft text-brand-soft-foreground ring-brand/30";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="flex items-center gap-2 truncate">
            {selected ? (
              <>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] leading-none ring-1 ring-inset ${toneClass}`}
                >
                  {selected.reduced_code}
                </span>
                <span className="truncate">{selected.name}</span>
              </>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Código ou nome da conta"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>Nenhuma conta encontrada.</CommandEmpty>
            <CommandGroup>
              {filtered.map((account) => {
                const active = account.reduced_code === value;
                return (
                  <CommandItem
                    key={account.reduced_code}
                    value={account.reduced_code}
                    onSelect={() => {
                      onChange(account.reduced_code);
                      setSearch("");
                      setOpen(false);
                    }}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] leading-none ring-1 ring-inset ${toneClass}`}
                      >
                        {account.reduced_code}
                      </span>
                      <span className="truncate">{account.name}</span>
                    </span>
                    {active ? (
                      <Check className={cn("ml-auto h-4 w-4")} />
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
