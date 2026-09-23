import { useParams } from 'wouter';
import { useGetJavnaRestavracija } from '@workspace/api-client-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ReservationFlow } from '@/components/restaurant/reservation-flow';
import { VoucherFlow } from '@/components/restaurant/voucher-flow';
import { PublicVenueView } from '@workspace/public-venue-ui';

export default function RestaurantProfile() {
  const { slug } = useParams<{ slug: string }>();
  return <RestaurantProfileContent slug={slug} />;
}

export function RestaurantProfileContent({ slug }: { slug: string }) {
  const { data: restaurant, isLoading, error } = useGetJavnaRestavracija(slug);

  if (isLoading) {
    return <RestaurantProfileSkeleton />;
  }

  if (error || !restaurant) {
    return (
      <div className="restaurant-container text-center py-20">
        <h1 className="text-2xl font-serif text-foreground mb-4">Restavracija ni najdena</h1>
        <p className="text-muted-foreground">Preverite povezavo in poskusite znova.</p>
      </div>
    );
  }

  return (
    <PublicVenueView
      restaurant={restaurant}
      reservationContent={<ReservationFlow restaurant={restaurant} />}
      voucherContent={<VoucherFlow restaurant={restaurant} />}
    />
  );
}

function RestaurantProfileSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <Skeleton className="h-64 md:h-80 w-full" />
      <div className="restaurant-container -mt-8 relative z-20">
        <Skeleton className="h-48 w-full rounded-xl mb-8" />
        <Skeleton className="h-14 w-full rounded-lg mb-8" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    </div>
  );
}
