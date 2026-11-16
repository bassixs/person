import { useId } from "react";
import type { Hair, Look } from "./personas";

/** Условная иллюстрация персонажа: без черт лица — это модель, а не портрет человека. */

const HAIR: Record<Exclude<Hair, "curly" | "cap" | "bun">, string> = {
  short: "M97 200C93 150 120 130 152 130C186 130 210 152 204 200C197 172 180 158 151 158C122 158 104 172 97 200Z",
  bob: "M90 236C84 160 112 126 152 126C193 126 219 160 212 236C206 243 197 242 195 234C197 192 184 166 150 164C117 166 106 192 108 234C106 242 96 243 90 236Z",
  long: "M88 300C78 172 110 124 152 124C195 124 224 172 214 300C206 306 199 302 197 292C199 204 186 168 150 166C116 168 104 204 106 292C104 302 96 306 88 300Z",
};

function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * k)));
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

export function Avatar({ look, className }: { look: Look; className?: string }) {
  const id = useId().replace(/:/g, "");
  const cloth = shade(look.c2, 1.25);
  return (
    <svg viewBox="0 0 300 430" className={className} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={`bg${id}`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor={look.c1} />
          <stop offset="1" stopColor={look.c2} />
        </linearGradient>
        <radialGradient id={`glow${id}`} cx="0.5" cy="0.42" r="0.5">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`head${id}`}>
          <ellipse cx="150" cy="200" rx="52" ry="62" />
        </clipPath>
      </defs>
      <rect width="300" height="430" fill={`url(#bg${id})`} />
      {/* кольца «уровня» за персонажем */}
      {[150, 118, 86].map((r, i) => (
        <circle key={r} cx="150" cy="190" r={r} fill="none" stroke="#fff" strokeOpacity={0.08 + i * 0.04} strokeWidth="1.5" />
      ))}
      <circle cx="150" cy="190" r="150" fill={`url(#glow${id})`} />
      {/* плечи и шея */}
      <path d="M30 430C30 336 92 300 150 300C208 300 270 336 270 430Z" fill={cloth} />
      <path d="M118 300C130 318 170 318 182 300L150 340Z" fill={shade(look.c2, 0.85)} />
      <rect x="132" y="244" width="36" height="64" rx="16" fill={shade(look.skin, 0.88)} />
      {/* длинные волосы — за головой */}
      {look.hair === "long" && <path d={HAIR.long} fill={look.hairColor} />}
      {look.hair === "bob" && <path d={HAIR.bob} fill={look.hairColor} />}
      {/* голова с объёмной тенью */}
      <ellipse cx="150" cy="200" rx="52" ry="62" fill={look.skin} />
      <g clipPath={`url(#head${id})`}>
        <ellipse cx="190" cy="214" rx="40" ry="70" fill="#000" opacity="0.1" />
      </g>
      <ellipse cx="98" cy="206" rx="7" ry="12" fill={look.skin} />
      <ellipse cx="202" cy="206" rx="7" ry="12" fill={shade(look.skin, 0.92)} />
      {look.beard && (
        <path d="M104 214C108 258 128 266 150 266C172 266 192 258 196 214C188 238 172 246 150 246C128 246 112 238 104 214Z" fill={look.hairColor} opacity="0.92" />
      )}
      {look.hair === "short" && <path d={HAIR.short} fill={look.hairColor} />}
      {look.hair === "bob" && (
        <path d="M100 196C104 154 126 136 152 136C180 136 200 154 202 196C190 174 172 166 150 166C128 166 110 174 100 196Z" fill={look.hairColor} />
      )}
      {look.hair === "long" && (
        <path d="M99 198C102 152 126 134 152 134C180 134 202 152 203 198C192 176 174 166 152 166C130 166 110 176 99 198Z" fill={look.hairColor} />
      )}
      {look.hair === "bun" && (
        <>
          <circle cx="150" cy="128" r="24" fill={look.hairColor} />
          <path d="M98 200C94 152 120 136 150 136C182 136 208 152 202 200C194 172 176 160 150 160C124 160 106 172 98 200Z" fill={look.hairColor} />
        </>
      )}
      {look.hair === "curly" && (
        <g fill={look.hairColor}>
          {[
            [108, 168, 20],
            [126, 146, 22],
            [152, 138, 24],
            [178, 146, 22],
            [196, 168, 20],
            [104, 192, 13],
            [198, 192, 13],
          ].map(([x, y, r]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={r} />
          ))}
        </g>
      )}
      {look.hair === "cap" && (
        <>
          <path d="M96 186C96 142 120 128 150 128C182 128 204 142 204 186Z" fill={shade(look.c1, 0.75)} />
          <path d="M96 182L238 190C240 200 224 202 204 200L96 196Z" fill={shade(look.c1, 0.6)} />
          <circle cx="150" cy="130" r="5" fill={shade(look.c1, 0.6)} />
        </>
      )}
      {look.glasses && (
        <g fill="none" stroke="#1a1a1a" strokeWidth="4" strokeOpacity="0.85">
          <rect x="108" y="192" width="36" height="24" rx="10" />
          <rect x="156" y="192" width="36" height="24" rx="10" />
          <path d="M144 202h12" />
        </g>
      )}
    </svg>
  );
}
