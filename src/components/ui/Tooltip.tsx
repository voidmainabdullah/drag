import type { ReactNode } from 'react'

export function Tooltip({ label, children, side = 'bottom' }: { label: string; children: ReactNode; side?: 'top' | 'bottom' | 'right' }) {
  const pos = side === 'top' ? 'bottom-full mb-1.5 left-1/2 -translate-x-1/2' : side === 'right' ? 'left-full ml-2 top-1/2 -translate-y-1/2' : 'top-full mt-1.5 left-1/2 -translate-x-1/2'
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-[80] hidden rounded-md bg-[#1f2230] px-2 py-1 text-[11px] font-medium whitespace-nowrap text-white shadow-lg group-hover/tt:block ${pos}`}
      >
        {label}
      </span>
    </span>
  )
}
