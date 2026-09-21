import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0B0F" },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL("https://sudarshanai.com"),
  title: "Sudarshan AI | Infrastructure for AI Agents",
  description:
    "Sudarshan AI is a customizable, model-agnostic infrastructure layer for AI agents, providing the environment, tools, permissions, verification and reliability controls around agent execution.",
  applicationName: "Sudarshan AI",
  authors: [{ name: "Sudarshan AI", url: "https://sudarshanai.com" }],
  creator: "Sudarshan AI",
  publisher: "Sudarshan AI",
  category: "technology",
  manifest: "/manifest.webmanifest",
  keywords: [
    "Sudarshan AI",
    "SUTRA",
    "AI agent infrastructure",
    "AI agent harness",
    "agent runtime",
    "AI agent security",
    "independent verification",
    "Agent SRE",
    "agent reliability",
    "agent observability",
    "model-agnostic AI agents",
    "MCP",
    "agent governance",
    "autonomous agent control plane",
  ],
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/logo.png", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/logo.png",
  },
  openGraph: {
    title: "Sudarshan AI — Build the environment your AI agents operate in",
    description:
      "A customizable, model-agnostic infrastructure layer for AI agents. Build environments with the tools, permissions, independent verification, and reliability controls you choose. SUTRA is the first product built by Sudarshan AI.",
    url: "/",
    siteName: "Sudarshan AI",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "/logo.png",
        width: 1200,
        height: 630,
        alt: "Sudarshan AI — Infrastructure for AI Agents",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Sudarshan AI — Build the environment your AI agents operate in",
    description:
      "A customizable, model-agnostic infrastructure layer for AI agents. SUTRA is built by Sudarshan AI.",
    images: ["/logo.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://sudarshanai.com/#organization",
        "name": "Sudarshan AI",
        "url": "https://sudarshanai.com",
        "description": "Sudarshan AI is the company building AI agent infrastructure and SUTRA.",
        "makesOffer": [
          {
            "@type": "Offer",
            "itemOffered": {
              "@type": "SoftwareApplication",
              "name": "SUTRA",
              "url": "https://sutra.sudarshanai.com",
              "applicationCategory": "DeveloperApplication",
              "operatingSystem": "Cross-platform",
              "description": "AI-Native Engineering Control Plane built by Sudarshan AI."
            }
          }
        ]
      },
      {
        "@type": "WebSite",
        "@id": "https://sudarshanai.com/#website",
        "url": "https://sudarshanai.com",
        "name": "Sudarshan AI",
        "description": "Infrastructure for AI Agents by Sudarshan AI",
        "publisher": {
          "@id": "https://sudarshanai.com/#organization"
        }
      }
    ]
  };

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
