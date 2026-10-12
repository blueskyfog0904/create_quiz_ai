import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 예전 상품 상세·게시판 목록 주소 → 새 주소. 307로 시작한다(308 전환은 docs/market-category-tree-plan.md 8.12 조건 충족 뒤 별도 커밋).
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
      // 예전 게시판 목록 주소 → 홈(S4). 상세 규칙 뒤에 둔다. 원래 쿼리(?subject= 등)는 Next가 목적지에 그대로 붙인다.
      {
        source: "/:subject(english|korean)/market",
        destination: "/?subject=:subject",
        permanent: false,
      },
      {
        source: "/:subject(english|korean)/market/:slug",
        destination: "/?subject=:subject",
        permanent: false,
      },
      {
        source: "/:subject(english|korean)/market/:slug/board-preview",
        destination: "/?subject=:subject",
        permanent: false,
      },
      {
        source: "/market",
        destination: "/",
        permanent: false,
      },
      {
        source: "/market/:slug",
        destination: "/",
        permanent: false,
      },
      {
        source: "/market/:slug/board-preview",
        destination: "/",
        permanent: false,
      },
      {
        source: "/preview/solvook-concept/boards/:slug",
        destination: "/",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
