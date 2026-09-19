import Link from 'next/link'
import { cn } from '@/lib/utils'

type BrandLogoProps = {
  className?: string
  priority?: boolean
  href?: string | null
  /** Light logo for dark backgrounds (hero) */
  variant?: 'default' | 'onDark'
}

export function BrandLogo({
  className,
  href = '/',
  variant = 'default',
}: BrandLogoProps) {
  const image = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/nuri-seckin-logo.svg"
      alt="Nuri Seçkin"
      width={360}
      height={110}
      className={cn(
        'h-11 w-auto object-contain object-left text-espresso md:h-14',
        variant === 'onDark' && 'brightness-0 invert',
        className
      )}
    />
  )

  if (!href) return image
  return (
    <Link href={href} className="inline-flex shrink-0 items-center text-espresso" aria-label="Nuri Seçkin ana sayfa">
      {image}
    </Link>
  )
}
