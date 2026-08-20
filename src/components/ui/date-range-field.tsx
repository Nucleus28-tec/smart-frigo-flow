/**
 * Campo único de intervalo de datas (de/até) com calendário em modo range e
 * atalhos rápidos. Usa strings ISO (yyyy-MM-dd) para conversar direto com as RPCs.
 */
import { useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { CalendarIcon, Eraser } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type DateRangeValue = { from: string; to: string };

function toDate(value: string): Date | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

function toIso(date: Date | undefined): string {
  if (!date) return "";
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

function label(value: string) {
  if (!value) return "";
  const [y, m, d] = value.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function monthBounds(base: Date) {
  const from = new Date(base.getFullYear(), base.getMonth(), 1);
  const to = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  return { from: toIso(from), to: toIso(to) };
}

type Props = {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  /** Mês de referência (yyyy-MM-dd) usado nos atalhos e no mês inicial do calendário. */
  referenceMonth?: string | null;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
};

export function DateRangeField({
  value,
  onChange,
  referenceMonth = null,
  placeholder = "Selecione o período",
  className,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);

  const reference = useMemo(() => toDate(referenceMonth ?? "") ?? new Date(), [referenceMonth]);

  const range: DateRange | undefined = useMemo(() => {
    const from = toDate(value.from);
    const to = toDate(value.to);
    if (!from && !to) return undefined;
    return { from: from ?? to, to: to ?? from };
  }, [value.from, value.to]);

  const shortcuts = useMemo(() => {
    const year = reference.getFullYear();
    const prev = new Date(year, reference.getMonth() - 1, 1);
    return [
      { label: "Mês de referência", value: monthBounds(reference) },
      { label: "Mês anterior", value: monthBounds(prev) },
      {
        label: "Últimos 3 meses",
        value: {
          from: toIso(new Date(year, reference.getMonth() - 2, 1)),
          to: monthBounds(reference).to,
        },
      },
      { label: "Ano atual", value: { from: `${year}-01-01`, to: `${year}-12-31` } },
    ];
  }, [reference]);

  const text =
    value.from || value.to
      ? `${label(value.from) || "início"} até ${label(value.to) || "fim"}`
      : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal",
            !value.from && !value.to && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          <span className="truncate">{text}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex shrink-0 flex-col gap-1 border-b p-2 sm:border-b-0 sm:border-r">
            {shortcuts.map((item) => (
              <Button
                key={item.label}
                type="button"
                variant="ghost"
                size="sm"
                className="justify-start text-xs"
                onClick={() => onChange(item.value)}
              >
                {item.label}
              </Button>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start text-xs"
              onClick={() => onChange({ from: "", to: "" })}
            >
              <Eraser className="mr-2 h-3.5 w-3.5" /> Limpar
            </Button>
          </div>
          <Calendar
            mode="range"
            numberOfMonths={2}
            defaultMonth={toDate(value.from) ?? reference}
            selected={range}
            onSelect={(next) => {
              onChange({ from: toIso(next?.from), to: toIso(next?.to) });
              if (next?.from && next?.to) setOpen(false);
            }}
            className={cn("p-3 pointer-events-auto")}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
