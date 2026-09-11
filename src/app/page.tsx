import { Suspense } from "react";
import { Panel } from "@/components/panel/panel";
import { datosDelPanel } from "@/lib/panel-datos";
import { Skeleton } from "@/components/ui/skeleton";

export const dynamic = "force-dynamic";

/** Skeletons con la forma del contenido final, nunca spinners. */
function PanelSkeleton() {
  return (
    <div className="p-6">
      <Skeleton className="mb-4 h-10 w-full" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {[3, 3, 3, 3].map((c, i) => (
          <Skeleton key={i} className={`h-28 lg:col-span-${c}`} />
        ))}
        <Skeleton className="h-80 lg:col-span-8" />
        <Skeleton className="h-80 lg:col-span-4" />
      </div>
    </div>
  );
}

async function PanelConDatos() {
  const datos = await datosDelPanel();
  return <Panel inicial={datos} />;
}

export default function Home() {
  return (
    <Suspense fallback={<PanelSkeleton />}>
      <PanelConDatos />
    </Suspense>
  );
}
