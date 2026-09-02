"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"

/**
 * Theme toggle. One click, light to dark and back.
 *
 * Built on the shadcn `Button` primitive rather than a hand-rolled control, so it
 * inherits the project's focus ring, press feedback and sizing. Note this is the
 * BASE UI distribution, not Radix: there is no `asChild`, triggers take `render`.
 * Sharp corners come for free because the button's `rounded-2xl` resolves through
 * `--radius: 0rem`.
 *
 * WHICH ICON IS SHOWING IS DRIVEN BY CSS, NOT STATE. Both glyphs are rendered and
 * the `dark:` variant decides which one is visible, so the correct icon paints on
 * the server and there is no hydration mismatch and no flash of the wrong glyph
 * while next-themes reads storage. JavaScript is only involved in the click.
 *
 * Samuel asked for the shadcn switcher with a plain click toggle, which is why this
 * is a sun and a moon: that pairing is on the anti-slop list, and his instruction
 * overrides the list. If the three-way (light / dark / system) is ever wanted, wrap
 * this trigger in `DropdownMenu` and keep the same icon.
 */
export function ThemeSwitch({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label="Toggle between the paper and ink themes"
    >
      <Sun className="hidden dark:block" />
      <Moon className="block dark:hidden" />
    </Button>
  )
}
