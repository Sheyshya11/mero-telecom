import { RelocationDetail } from '../../../../features/relocations/relocation-detail';

export default async function AdminRelocationPage({
  params,
}: PageProps<'/admin/relocations/[relocationId]'>) {
  const { relocationId } = await params;
  return <RelocationDetail basePath="/admin/relocations" relocationId={relocationId} />;
}
