import { RelocationDetail } from '../../../../features/relocations/relocation-detail';

export default async function StaffRelocationPage({
  params,
}: PageProps<'/staff/relocations/[relocationId]'>) {
  const { relocationId } = await params;
  return <RelocationDetail basePath="/staff/relocations" relocationId={relocationId} />;
}
