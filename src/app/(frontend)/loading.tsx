export default function Loading() {
  return (
    <div className="container-page py-16">
      <div className="skeleton h-10 w-48" />
      <div className="mt-4 skeleton h-5 w-72" />
      <div className="mt-12 grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-3">
            <div className="skeleton aspect-[3/4] w-full" />
            <div className="skeleton h-4 w-3/4" />
            <div className="skeleton h-4 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  )
}
