// Hugeicons 무료 세트(둥근 선, MIT 라이선스 — https://hugeicons.com)의 SVG 를 옮긴 것이다.
// 이름은 공식 패키지(@hugeicons/core-free-icons)의 내보내기 이름과 같게 두었다.
import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function Svg({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" {...props}>
      {children}
    </svg>
  )
}

export function Notification01Icon(props: IconProps) {
  return <Svg {...props}><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15.5 18a3.5 3.5 0 1 1-7 0m10.731 0H4.77a1.769 1.769 0 0 1-1.25-3.02l.602-.603A3 3 0 0 0 5 12.256V9.5a7 7 0 0 1 14 0v2.756a3 3 0 0 0 .879 2.121l.603.603a1.77 1.77 0 0 1-1.25 3.02" /></Svg>
}

export function Coins01Icon(props: IconProps) {
  return <Svg {...props}><g fill="none" stroke="currentColor" strokeWidth="1.5"><ellipse cx="15.5" cy="11" rx="6.5" ry="2" /><path d="M22 15.5c0 1.105-2.91 2-6.5 2s-6.5-.895-6.5-2" /><path d="M22 11v8.8c0 1.215-2.91 2.2-6.5 2.2S9 21.015 9 19.8V11" /><ellipse cx="8.5" cy="4" rx="6.5" ry="2" /><path strokeLinecap="round" d="M6 11c-1.892-.23-3.63-.825-4-2m4 7c-1.892-.23-3.63-.825-4-2" /><path strokeLinecap="round" d="M6 21c-1.892-.23-3.63-.826-4-2V4m13 2V4" /></g></Svg>
}

export function ShoppingCart02Icon(props: IconProps) {
  return <Svg {...props}><g fill="none" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" d="m8 16l8.72-.727c2.729-.227 3.341-.823 3.643-3.544L21 6M6 6h16" /><circle cx="6" cy="20" r="2" /><circle cx="17" cy="20" r="2" /><path strokeLinecap="round" d="M8 20h7M2 2h.966c.945 0 1.768.625 1.997 1.515L7.94 15.076a1.96 1.96 0 0 1-.35 1.686L6.631 18" /></g></Svg>
}

export function LibraryIcon(props: IconProps) {
  return <Svg {...props}><g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"><path d="M2 7c0-1.4 0-2.1.272-2.635a2.5 2.5 0 0 1 1.093-1.093C3.9 3 4.6 3 6 3s2.1 0 2.635.272a2.5 2.5 0 0 1 1.093 1.093C10 4.9 10 5.6 10 7v10c0 1.4 0 2.1-.272 2.635a2.5 2.5 0 0 1-1.093 1.092C8.1 21 7.4 21 6 21s-2.1 0-2.635-.273a2.5 2.5 0 0 1-1.093-1.092C2 19.1 2 18.4 2 17z" /><path d="M6.125 17H6m.25 0a.25.25 0 1 1-.5 0a.25.25 0 0 1 .5 0m11.656-.307h-.125m.25 0a.25.25 0 1 1-.5 0a.25.25 0 0 1 .5 0M2 7h8" /><path d="M11.449 8.268c-.355-1.33-.533-1.995-.41-2.572a2.46 2.46 0 0 1 .756-1.316c.437-.395 1.1-.573 2.424-.93c1.324-.356 1.987-.534 2.561-.411a2.44 2.44 0 0 1 1.31.76c.394.438.572 1.103.927 2.433l2.534 9.5c.355 1.33.533 1.995.41 2.572a2.46 2.46 0 0 1-.756 1.316c-.437.395-1.1.573-2.424.93c-1.324.356-1.986.534-2.561.411a2.45 2.45 0 0 1-1.31-.76c-.394-.438-.572-1.103-.927-2.433zM12 8l6.5-2" /></g></Svg>
}

export function UserIcon(props: IconProps) {
  return <Svg {...props}><g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"><path d="M20 21a7.53 7.53 0 0 0-7.005-6.934L12 14q-.531.015-1 .038c-3.7.181-6.716 3.268-7 6.962" /><circle cx="12" cy="7" r="4" /></g></Svg>
}

export function Search01Icon(props: IconProps) {
  return <Svg {...props}><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="m17 17l4 4m-2-10a8 8 0 1 0-16 0a8 8 0 0 0 16 0" /></Svg>
}

export function GridViewIcon(props: IconProps) {
  return <Svg {...props}><path fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" d="M3.889 9.663C4.393 10 5.096 10 6.5 10s2.107 0 2.611-.337a2 2 0 0 0 .552-.552C10 8.607 10 7.904 10 6.5s0-2.107-.337-2.611a2 2 0 0 0-.552-.552C8.607 3 7.904 3 6.5 3s-2.107 0-2.611.337a2 2 0 0 0-.552.552C3 4.393 3 5.096 3 6.5s0 2.107.337 2.611a2 2 0 0 0 .552.552Zm11 0C15.393 10 16.096 10 17.5 10s2.107 0 2.611-.337a2 2 0 0 0 .552-.552C21 8.607 21 7.904 21 6.5s0-2.107-.337-2.611a2 2 0 0 0-.552-.552C19.607 3 18.904 3 17.5 3s-2.107 0-2.611.337a2 2 0 0 0-.552.552C14 4.393 14 5.096 14 6.5s0 2.107.337 2.611a2 2 0 0 0 .552.552Zm-11 11C4.393 21 5.096 21 6.5 21s2.107 0 2.611-.337a2 2 0 0 0 .552-.552C10 19.607 10 18.904 10 17.5s0-2.107-.337-2.611a2 2 0 0 0-.552-.552C8.607 14 7.904 14 6.5 14s-2.107 0-2.611.337a2 2 0 0 0-.552.552C3 15.393 3 16.096 3 17.5s0 2.107.337 2.611a2 2 0 0 0 .552.552Zm11 0C15.393 21 16.096 21 17.5 21s2.107 0 2.611-.337c.218-.146.406-.334.552-.552C21 19.607 21 18.904 21 17.5s0-2.107-.337-2.611a2 2 0 0 0-.552-.552C19.607 14 18.904 14 17.5 14s-2.107 0-2.611.337a2 2 0 0 0-.552.552C14 15.393 14 16.096 14 17.5s0 2.107.337 2.611c.146.218.334.406.552.552Z" /></Svg>
}

export function Wallet01Icon(props: IconProps) {
  return <Svg {...props}><g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"><path d="M5 3h9c.93 0 1.395 0 1.777.102a3 3 0 0 1 2.12 2.122C18 5.605 18 6.07 18 7H5a2 2 0 1 1 0-4" /><path d="M3 5v10c0 2.828 0 4.243.879 5.121C4.757 21 6.172 21 9 21h6c2.828 0 4.243 0 5.121-.879C21 19.243 21 17.828 21 15v-2c0-2.828 0-4.243-.879-5.121C19.243 7 17.828 7 15 7H7" /><path d="M21 12h-2c-.465 0-.698 0-.888.051a1.5 1.5 0 0 0-1.06 1.06C17 13.303 17 13.536 17 14s0 .697.051.888a1.5 1.5 0 0 0 1.06 1.06c.191.052.424.052.889.052h2" /></g></Svg>
}

export function ArrowDown01Icon(props: IconProps) {
  return <Svg {...props}><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M18 9s-4.419 6-6 6s-6-6-6-6" /></Svg>
}
