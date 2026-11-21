import Link from 'next/link'
import Image from 'next/image'
import { cn } from '@/lib/utils'

type BrandLogoProps = {
  /** Sets the logo height (e.g. `h-9`); the width follows the wordmark's aspect ratio. */
  className?: string
  priority?: boolean
  href?: string | null
}

/** Horizontal wordmark (mark + "NuriSeçkin") on a transparent background. */
export function BrandLogo({ className, priority, href = '/' }: BrandLogoProps) {
  const image = (
    <Image
      src="/brand/nuri-seckin-wordmark.png"
      alt="Nuri Seçkin"
      width={825}
      height={174}
      priority={priority}
      sizes="(min-width: 768px) 200px, 160px"
      className={cn('h-8 w-auto shrink-0', className)}
    />
  )

  if (!href) return image
  return (
    <Link href={href} className="inline-flex shrink-0 items-center" aria-label="Nuri Seçkin ana sayfa">
      {image}
    </Link>
  )
}
