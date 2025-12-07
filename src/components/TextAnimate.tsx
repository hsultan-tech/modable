import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'

interface TextAnimateProps {
  children: string
  className?: string
  animation?: 'blurInUp' | 'fadeIn'
  by?: 'word' | 'char'
  startOnView?: boolean
}

export function TextAnimate({ 
  children, 
  className, 
  animation = 'blurInUp',
  by = 'word',
  startOnView = true 
}: TextAnimateProps) {
  const words = by === 'word' ? children.split(' ') : children.split('')
  
  const variants = {
    hidden: { opacity: 0, y: 20, filter: 'blur(10px)' },
    visible: { opacity: 1, y: 0, filter: 'blur(0px)' }
  }

  return (
    <motion.span
      className={cn('inline-block', className)}
      initial={startOnView ? 'hidden' : 'visible'}
      animate="visible"
      transition={{ staggerChildren: 0.05 }}
    >
      {words.map((word, i) => (
        <motion.span
          key={i}
          className="inline-block"
          variants={variants}
          transition={{ duration: 0.3 }}
        >
          {word}
          {by === 'word' && i < words.length - 1 ? '\u00A0' : ''}
        </motion.span>
      ))}
    </motion.span>
  )
}
