import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const geist = Geist_Mono({ subsets: ["latin"], variable: "--font-geist" });

export const metadata: Metadata = {
  title: "sit — a market maker that sits",
  description: "Two-sided post-only quotes on Kuru. Jev is a sensor. Code sits.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${geist.variable}`}>{children}</body>
    </html>
  );
}
