import { Moon, Sun, Monitor } from "lucide-react";

import { useTheme } from "@/hooks/useTheme";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ThemeToggle() {
  const { mode, resolved, setMode, toggle } = useTheme();

  return (
    <div className="flex items-center">
      <Button
        variant="outline"
        size="icon"
        className="glow-surface size-9 rounded-r-none border-r-0"
        onClick={toggle}
        aria-label={resolved === "dark" ? "Ativar modo claro" : "Ativar modo noite"}
        title={resolved === "dark" ? "Modo claro" : "Modo noite"}
      >
        {resolved === "dark" ? (
          <Sun className="size-4 text-brand" />
        ) : (
          <Moon className="size-4 text-muted-foreground" />
        )}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="glow-surface size-9 rounded-l-none px-0"
            aria-label="Escolher tema"
          >
            <Monitor className="size-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setMode("light")}>
            <Sun className="size-4" /> Claro {mode === "light" ? "✓" : ""}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setMode("dark")}>
            <Moon className="size-4" /> Noite {mode === "dark" ? "✓" : ""}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setMode("system")}>
            <Monitor className="size-4" /> Sistema {mode === "system" ? "✓" : ""}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
