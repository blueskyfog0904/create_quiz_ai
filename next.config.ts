import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 예전 상품 상세 주소 → /items/[itemId]. 307로 시작한다(308 전환은 docs/market-category-tree-plan.md 8.12 조건 충족 뒤 별도 커밋).
  async redirects() {
    return [
      {
        source: "/preview/solvook-concept/boards/:slug/items/:itemId",
        destination: "/items/:itemId",
        permanent: false,
      },
      {
        source: "/:subject(english|korean)/market/:slug/items/:itemId",
        destination: "/items/:itemId?subject=:subject",
        permanent: false,
      },
      {
        source: "/market/:slug/items/:itemId",
        destination: "/items/:itemId",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
