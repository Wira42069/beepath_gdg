import type { Metadata } from 'next';
import { MyProgress } from '@/components/MyProgress';
import { availableRoles } from '@/lib/roles';

export const metadata: Metadata = { title: 'My progress · BeePath' };

export default function MePage() {
  return <MyProgress roles={availableRoles()} />;
}
