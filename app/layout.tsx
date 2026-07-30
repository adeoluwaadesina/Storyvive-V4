import type { Metadata } from "next";
import { Fredoka } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const fredoka = Fredoka({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-logo" });

export const metadata: Metadata = {
  title: "Storyvive",
  description: "Canon-faithful fan fiction, generated for you.",
};

// Applies the saved theme before paint, so there's no flash of the wrong
// theme on load — this has to run inline, before React hydrates.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var saved = localStorage.getItem("storyvive-theme");
    var theme = saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    if (theme === "dark") document.documentElement.classList.add("dark");
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fredoka.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
