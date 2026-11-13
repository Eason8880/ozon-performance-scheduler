import type { Metadata } from "next";
import "./style.css";
export const metadata: Metadata = {
  title: "Ozon Performance 时间开关",
  description: "按店铺时区定时开启和关闭 Ozon 按订单付款推广",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
