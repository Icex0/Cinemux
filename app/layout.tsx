import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "Cinemux",
  description: "Stream movies and TV",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body>
        {children}
        <footer className="site-footer">
          <p>
            <strong>Disclaimer:</strong> This site does not store any files on its server.
            All contents are provided by non-affiliated third parties.
          </p>
        </footer>
      </body>
    </html>
  );
}
