import { useEffect, useRef, useState } from 'react'
import { Eraser } from 'lucide-react'
import { Button } from '#/components/ui/Button'

export function SignaturePad({ value, onChange, disabled }: { value?: string; onChange: (v: string) => void; disabled?: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
    if (value) {
      const img = new window.Image()
      img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height)
      img.src = value
    }
  }, [value])

  const pos = (e: React.PointerEvent) => {
    const c = ref.current!
    const r = c.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height }
  }

  const start = (e: React.PointerEvent) => {
    if (disabled) return
    const ctx = ref.current!.getContext('2d')!
    drawing.current = true
    ref.current!.setPointerCapture(e.pointerId)
    const { x, y } = pos(e)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1f2230'
    ctx.beginPath()
    ctx.moveTo(x, y)
  }
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return
    const ctx = ref.current!.getContext('2d')!
    const { x, y } = pos(e)
    ctx.lineTo(x, y)
    ctx.stroke()
    setDirty(true)
  }
  const end = () => {
    if (!drawing.current) return
    drawing.current = false
    onChange(ref.current!.toDataURL('image/png'))
  }
  const clear = () => {
    const c = ref.current!
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    setDirty(false)
    onChange('')
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={ref}
        width={480}
        height={160}
        aria-label="Signature pad"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="h-32 w-full touch-none rounded-lg border border-dashed border-line bg-white"
        style={{ cursor: disabled ? 'not-allowed' : 'crosshair' }}
      />
      {!disabled && (
        <div className="flex items-center justify-between text-xs text-muted">
          <span>{value || dirty ? 'Signature captured' : 'Sign above with your mouse or finger'}</span>
          <Button size="xs" variant="ghost" onClick={clear}>
            <Eraser size={12} /> Clear
          </Button>
        </div>
      )}
    </div>
  )
}
