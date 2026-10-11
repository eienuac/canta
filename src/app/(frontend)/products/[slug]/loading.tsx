export default function ProductLoading() {
  return (
    <div className="container-page py-10 md:py-14">
      <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
        <div className="skeleton aspect-[4/5] w-full" />
        <div className="space-y-4">
          <div className="skeleton h-3 w-24" />
          <div className="skeleton h-12 w-4/5" />
          <div className="skeleton h-8 w-32" />
          <div className="skeleton mt-8 h-12 w-full" />
        </div>
      </div>
    </div>
  )
}
