import { Geist, Geist_Mono } from "next/font/google"
import localFont from "next/font/local"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

/**
 * Type system. Three faces, three jobs, no overlap.
 *
 * ZODIAK (display) — verdicts, headline figures, section heads. A Century-model
 * bracketed slab: the typographic register of financial reporting and legal
 * exhibits rather than of magazines. Chosen for one specific property — its
 * nineteenth-century uppercase proportions extend to the NUMERALS, so they are
 * near-monospaced by construction and headline figures column up without
 * needing tabular-nums. Fathom is a wall of figures; that is not incidental.
 *
 * GEIST (interface) — body, labels, controls. Deliberately quiet: the display
 * face carries the identity, so the workhorse should not compete.
 *
 * GEIST MONO (data) — every measured figure, via `.font-data`. Mono is a costume
 * when it carries running prose, but here the content genuinely IS data, which
 * is the one case where it is the honest choice.
 *
 * Self-hosted from `public/fonts` rather than a CDN link so there is no
 * render-blocking third-party request and no layout shift.
 */
const fontDisplay = localFont({
  src: [
    { path: "../public/fonts/Zodiak-300.woff2", weight: "300", style: "normal" },
    { path: "../public/fonts/Zodiak-400.woff2", weight: "400", style: "normal" },
    { path: "../public/fonts/Zodiak-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
})

const fontSans = Geist({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" })

export const metadata = {
  title: "Fathom: risk verdicts for DreamDEX Event Contracts",
  description:
    "Every verdict computed in code, every number traced to a measurement. ALLOW / RECHECK / BLOCK with an inspectable decision trace.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontDisplay.variable,
        fontSans.variable,
        fontMono.variable,
      )}
    >
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
