import { RelocationDetail } from '../../../../features/relocations/relocation-detail';

export default async function ControlCentreRelocationPage({
  params,
}: PageProps<'/control-centre/relocations/[relocationId]'>) {
  const { relocationId } = await params;
  return <RelocationDetail basePath="/control-centre/relocations" relocationId={relocationId} />;
}
