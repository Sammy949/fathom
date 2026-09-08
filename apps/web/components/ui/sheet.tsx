"use client"

import * as React from "react"
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/30 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-sm",
        className
      )}
      {...props}
    />
  )
}

type SheetSide = "top" | "right" | "bottom" | "left"

/**
 * BELOW `sm` A SIDE SHEET IS A BOTTOM DRAWER, and above it, the side panel it was.
 *
 * Two problems, one fix. The panel carried a 480px MINIMUM WIDTH, unconditional —
 * so on any phone narrower than that it was wider than the screen: the content ran off the
 * edge and the close button could sit outside the viewport. And a 75%-width panel sliding
 * in from the right is a desktop idiom; on a phone the thing that reads as "more detail,
 * dismissible" is a sheet that comes up from the bottom edge, under the thumb.
 *
 * So the drawer is the BASE and the panel is the `sm:` enhancement, rather than the panel
 * being patched with mobile overrides. That ordering matters: overrides layered on top of
 * `data-[side=right]:` rules land at the same specificity and are then decided by the order
 * Tailwind happens to emit them in, which is not something to depend on. Written this way
 * the mobile rules are unconditional and only the `sm:` ones can win, which is exactly the
 * cascade this needs.
 *
 * Capped at `85svh` — `svh`, not `vh`, so the drawer does not sit under a mobile browser's
 * collapsing address bar — with `overflow-y-auto` on the callers so long evidence scrolls
 * inside it rather than pushing the close button off screen.
 *
 * NO DRAG HANDLE. The grabber pill at the top of a drawer promises drag-to-dismiss, and
 * this is a Base UI Dialog, which does not drag. A control that invites a gesture it cannot
 * answer is worse than no control; the close button and the backdrop both work.
 *
 * `top` and `bottom` are untouched: they are already edge drawers at every width.
 */
const SHEET_BASE =
  "fixed z-50 flex flex-col overflow-hidden bg-popover bg-clip-padding text-sm text-popover-foreground " +
  "transition duration-200 ease-in-out data-ending-style:opacity-0 data-starting-style:opacity-0"

const AS_DRAWER =
  "inset-x-0 bottom-0 top-auto h-auto max-h-[85svh] w-full border-t " +
  "data-starting-style:translate-y-[2.5rem] data-ending-style:translate-y-[2.5rem]"

const SHEET_SIDE: Record<SheetSide, string> = {
  right:
    AS_DRAWER +
    " sm:inset-y-0 sm:right-0 sm:left-auto sm:h-full sm:max-h-none sm:w-3/4 sm:min-w-120 sm:max-w-sm" +
    " sm:border-t-0 sm:border-l" +
    " sm:data-starting-style:translate-y-0 sm:data-ending-style:translate-y-0" +
    " sm:data-starting-style:translate-x-[2.5rem] sm:data-ending-style:translate-x-[2.5rem]",
  left:
    AS_DRAWER +
    " sm:inset-y-0 sm:left-0 sm:right-auto sm:h-full sm:max-h-none sm:w-3/4 sm:min-w-120 sm:max-w-sm" +
    " sm:border-t-0 sm:border-r" +
    " sm:data-starting-style:translate-y-0 sm:data-ending-style:translate-y-0" +
    " sm:data-starting-style:translate-x-[-2.5rem] sm:data-ending-style:translate-x-[-2.5rem]",
  bottom:
    "inset-x-0 bottom-0 h-auto max-h-[85svh] border-t" +
    " data-starting-style:translate-y-[2.5rem] data-ending-style:translate-y-[2.5rem]",
  top:
    "inset-x-0 top-0 h-auto max-h-[85svh] border-b" +
    " data-starting-style:translate-y-[-2.5rem] data-ending-style:translate-y-[-2.5rem]",
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: SheetSide
  showCloseButton?: boolean
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(SHEET_BASE, SHEET_SIDE[side], className)}
        {...props}
      >
        {/* THE PANEL DOES NOT SCROLL; THIS DOES. The close button is positioned against the
            popup, so while the popup was itself the scroll container the button scrolled away
            with the content — a long provenance list pushed it off the top and left the
            backdrop as the only way out. Invisible on a full-height desktop panel, immediate
            on an 85svh drawer. `min-h-0` because a flex child will not shrink below its own
            content without it, which is the usual reason a nested scroller silently does
            nothing at all. */}
        <div data-slot="sheet-body" className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </div>
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-4 right-4 bg-secondary"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-6", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-6", className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "text-base font-medium text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
