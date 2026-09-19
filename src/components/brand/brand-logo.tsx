import Link from 'next/link'
import Image from 'next/image'
import { cn } from '@/lib/utils'

type BrandLogoProps = {
  className?: string
  priority?: boolean
  href?: string | null
}

export function BrandLogo({ className, priority, href = '/' }: BrandLogoProps) {
  const image = (
    <span
      className={cn(
        'inline-flex shrink-0 overflow-hidden rounded-full bg-white shadow-sm ring-1 ring-black/5',
        className
      )}
    >
      <Image
        src="/brand/nuri-seckin-logo.png"
        alt="Nuri Seçkin"
        width={640}
        height={640}
        priority={priority}
        className="h-full w-full object-cover"
      />
    </span>
  )

  if (!href) return image
  return (
    <Link href={href} className="inline-flex shrink-0 items-center" aria-label="Nuri Seçkin ana sayfa">
      {image}
    </Link>
  )
}
