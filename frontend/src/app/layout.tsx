import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: { default: "ArcReserve", template: "%s · ArcReserve" },
  description: "Verified asset participation markets with capped supply, protected reserves, and programmable liquidity.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  openGraph: {
    title: "ArcReserve · Real assets. Programmable liquidity.",
    description: "Verified asset participation markets with capped supply, protected reserves, and NAV-aware liquidity.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "ArcReserve solar asset liquidity market" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ArcReserve",
    description: "Real assets. Programmable liquidity.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers><AppShell>{children}</AppShell></Providers>
      </body>
    </html>
  );
}
