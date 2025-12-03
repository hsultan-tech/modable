import { cn } from '@/lib/utils'

interface KbdProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

export function Kbd({ children, className, ...props }: KbdProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 px-2 py-1 bg-white/5 border border-white/10 rounded text-xs font-mono text-white/60',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function KbdKey({ children }: { children: React.ReactNode }) {
  return <span className="text-white/80">{children}</span>
}
