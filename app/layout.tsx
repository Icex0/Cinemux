import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cinemux",
  description: "Stream movies and TV",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
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
