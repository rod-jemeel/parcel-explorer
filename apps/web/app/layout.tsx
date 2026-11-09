import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Parcel Explorer | Brooklyn research",
  description:
    "Explore real Brooklyn tax-lot boundaries and source-backed government property records. Private local pilot.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
