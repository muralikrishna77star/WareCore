import type { Metadata } from "next";
import "./globals.css";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { DesktopTitleBar } from "@/components/DesktopTitleBar";
import { BrandProvider } from "@/components/BrandProvider";
import { brandCss, getBrand, DEFAULT_BRAND_COLOR } from "@/lib/tenancy/brand";

// Verdana (text) and Century Gothic (numbers/data) are both system fonts,
// not Google Fonts — no next/font loader needed, set directly as CSS
// variables in globals.css's @theme block instead.

const BASE_METADATA: Metadata = {
  title: "WareCore — Warehouse Management",
  description: "Steel processing warehouse management system",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "WareCore",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    title: "WareCore",
    description: "Steel processing warehouse management system",
  },
};

// A customer's address shows the customer's name in the browser tab and when
// added to a phone's home screen; WareCore's own pages keep WareCore's.
export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  if (!brand.isCustomer) return BASE_METADATA;
  return {
    ...BASE_METADATA,
    title: `${brand.displayName} — WareCore`,
    appleWebApp: { capable: true, statusBarStyle: "default", title: brand.displayName },
    openGraph: { ...BASE_METADATA.openGraph, title: brand.displayName },
  };
}

export async function generateViewport() {
  const brand = await getBrand();
  return {
    themeColor: brand.color ?? DEFAULT_BRAND_COLOR,
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const brand = await getBrand();
  const css = brandCss(brand.color);
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        <link rel="apple-touch-icon" sizes="152x152" href="/icons/icon-152x152.png" />
        <link rel="apple-touch-icon" sizes="144x144" href="/icons/icon-144x144.png" />
        <link rel="apple-touch-icon" sizes="120x120" href="/icons/icon-128x128.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        {css && <style id="brand-colour">{css}</style>}
      </head>
      <body className="min-h-full flex flex-col">
        <BrandProvider brand={brand}>
          <ServiceWorkerRegistration />
          <DesktopTitleBar />
          {children}
        </BrandProvider>
      </body>
    </html>
  );
}
