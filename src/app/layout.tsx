import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { Sidebar } from "@/components/layout/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });

// Monoespaciada solo para valores numéricos, tablas y ejes de gráficos.
const mono = JetBrains_Mono({ variable: "--font-mono-num", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Roomba IoT — Panel de monitoreo",
  description: "Dashboard de monitoreo en la nube del robot aspirador",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${inter.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <ThemeProvider>
          <TooltipProvider>
            <div className="flex min-h-dvh">
              <Sidebar />
              <main className="min-w-0 flex-1">{children}</main>
            </div>
            <Toaster position="bottom-right" />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
