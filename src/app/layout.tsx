import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nocturne — Loup-Garou",
  description:
    "Rejoignez une partie de Loup-Garou, découvrez votre rôle secret et tentez de survivre jusqu&apos;à l&apos;aube.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="fr" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}