"use client";

/**
 * Combobox com busca por código hierárquico ou nome, usado para escolher o
 * grupo (conta sintética) de destino na reorganização do plano de contas.
 */
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type GroupOption = {
  hierarchical_code: string;
  name: string;
  level?: number | null;
};

function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

type Props = {
  value: string;
  onChange: (value: string) => void;
  groups: GroupOption[];
  placeholder?: string;
  disabled?: boolean;
};

export function GroupSelect({
  value,
  onChange,
  groups,
  placeholder = "Buscar grupo por código ou nome...",
  disabled,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const selected = React.useMemo(
    () => groups.find((g) => g.hierarchical_code === value) ?? null,
    [groups, value],
  );

  const filtered = React.useMemo(() => {
    const term = normalize(search);
    const list = term
      ? groups.filter((g) => normalize(`${g.hierarchical_code} ${g.name}`).includes(term))
      : groups;
    return list.slice(0, 200);
  }, [groups, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected
              ? `${selected.hierarchical_code} — ${selected.name}`
              : "Grupo de destino (conta sintética)"}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={search} onValueChange={setSearch} placeholder={placeholder} />
          <CommandList className="max-h-72">
            <CommandEmpty>Nenhum grupo encontrado.</CommandEmpty>
            <CommandGroup>
              {filtered.map((g) => (
                <CommandItem
                  key={g.hierarchical_code}
                  value={g.hierarchical_code}
                  onSelect={() => {
                    onChange(g.hierarchical_code);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 size-4",
                      value === g.hierarchical_code ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="mr-2 font-mono text-xs">{g.hierarchical_code}</span>
                  <span className="truncate">{g.name}</span>
                  {g.level ? (
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      nível {g.level}
                    </span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
