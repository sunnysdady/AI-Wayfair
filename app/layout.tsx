import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wayfair AI 运营中台",
  description: "连接 Dashboard、广告管理、计划复盘与商品库存的 Wayfair 运营工作台。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
