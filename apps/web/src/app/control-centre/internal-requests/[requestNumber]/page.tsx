import { InternalRequestDetail } from '../../../../features/internal-requests/internal-request-detail';

export default async function InternalRequestPage({
  params,
}: {
  params: Promise<{ requestNumber: string }>;
}) {
  const { requestNumber } = await params;
  return <InternalRequestDetail requestNumber={requestNumber} />;
}
