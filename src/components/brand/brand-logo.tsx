import Image from 'next/image'
import Link from 'next/link'
import { cn } from '@/lib/utils'

type BrandLogoProps = {
  className?: string
  priority?: boolean
  href?: string | null
}

export function BrandLogo({ className, priority, href = '/' }: BrandLogoProps) {
  const image = (
    <Image
      src="/brand/nuri-seckin-logo.png"
      alt="Nuri Seçkin"
      width={220}
      height={88}
      priority={priority}
      className={cn('h-10 w-auto object-contain md:h-12', className)}
    />
  )

  if (!href) return image
  return (
    <Link href={href} className="inline-flex items-center" aria-label="Nuri Seçkin ana sayfa">
      {image}
    </Link>
  )
}
