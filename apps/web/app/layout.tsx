import localFont from "next/font/local"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

/**
 * Type system. Three faces, three jobs, no overlap.
 *
 * ALL THREE ARE SELF-HOSTED FROM `public/fonts`, and that is not a preference any
 * more. Geist and Geist Mono came from `next/font/google`, which fetches at BUILD
 * time: `fonts.googleapis.com` resolves IPv6-only, this box has no working IPv6
 * (the NAT64 / ENETUNREACH problem logged in the Stage 1 notes), and the build
 * started failing outright with "Failed to fetch `Geist` from Google Fonts". A
 * build that needs a third-party host is a build that can fail on someone else's
 * network, including a deploy. The woff2 files are copied from their `@fontsource`
 * packages into `public/fonts`, so nothing here touches the network.
 *
 * INSTRUMENT SANS (interface) - body, labels, controls, navigation. A grotesque
 * with slightly condensed proportions and a tall x-height, so it holds up at the
 * 11-12px this interface leans on. Variable, one file, 100-900.
 *
 * INSTRUMENT SERIF (accent voice) - ITALIC ONLY, and used sparingly. Not a
 * headline face here: universe.works ships only the italic and uses it as a
 * counter-voice inside otherwise-sans composition, which is the move worth taking.
 *
 * ZODIAK (display) - verdicts, headline figures, section heads. Kept, because it
 * was chosen for one specific property no substitute has: its nineteenth-century
 * bracketed-slab construction extends to the NUMERALS, so they are near-monospaced
 * and headline figures column up without tabular-nums. Fathom is a wall of figures.
 *
 * GEIST MONO (data) - every measured figure, via `.font-data`. Mono is a costume
 * when it carries running prose; here the content genuinely IS data, which is the
 * one case where it is the honest choice.
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

const fontSans = localFont({
  src: [
    {
      path: "../public/fonts/InstrumentSans-Variable.woff2",
      weight: "100 900",
      style: "normal",
    },
    {
      path: "../public/fonts/InstrumentSans-VariableItalic.woff2",
      weight: "100 900",
      style: "italic",
    },
  ],
  variable: "--font-sans",
  display: "swap",
})

const fontSerif = localFont({
  src: [
    { path: "../public/fonts/InstrumentSerif-400.woff2", weight: "400", style: "normal" },
    { path: "../public/fonts/InstrumentSerif-400-Italic.woff2", weight: "400", style: "italic" },
  ],
  variable: "--font-serif",
  display: "swap",
})

const fontMono = localFont({
  src: "../public/fonts/GeistMono-Variable.woff2",
  weight: "100 900",
  variable: "--font-mono",
  display: "swap",
})

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
        fontSerif.variable,
        fontMono.variable,
      )}
    >
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
