import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wayfair AI 运营中台",
  description: "连接 Dashboard、广告管理、计划复盘与商品库存的 Wayfair 运营工作台。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=Manrope:wght@400;500;600;700;800&family=Noto+Sans+SC:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
