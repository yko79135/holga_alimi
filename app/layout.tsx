import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

const schoolName = process.env.NEXT_PUBLIC_SCHOOL_NAME || "우리학교 학부모 포털";

export const metadata: Metadata = {
  title: schoolName,
  description: "가정통신문과 학생별 생활지도 알림을 안전하게 전달하는 학부모 포털",
  manifest: "/manifest.webmanifest",
  // Same name as manifest.webmanifest's short_name, so the home-screen icon reads "홀가 포털"
  // whichever of the two iOS uses.
  appleWebApp: { capable: true, title: "홀가 포털", statusBarStyle: "default" },
  // Next only emits the generic mobile-web-app-capable tag; older iOS needs the apple- one to
  // open the home-screen icon as an app (no address bar) when it doesn't read the manifest.
  other: { "apple-mobile-web-app-capable": "yes" },
  icons: {
    icon: [
      {
        url: "/icons/holy-guide-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        url: "/icons/holy-guide-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      noarchive: true,
      nosnippet: true,
    },
  },
};

export const viewport: Viewport = { themeColor: "#244f59" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body><ServiceWorkerRegister />{children}</body>
    </html>
  );
}
