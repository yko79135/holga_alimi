import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

const schoolName = process.env.NEXT_PUBLIC_SCHOOL_NAME || "우리학교 학부모 포털";

export const metadata: Metadata = {
  title: schoolName,
  description: "가정통신문과 학생별 생활지도 알림을 안전하게 전달하는 학부모 포털",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: schoolName, statusBarStyle: "default" },
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
