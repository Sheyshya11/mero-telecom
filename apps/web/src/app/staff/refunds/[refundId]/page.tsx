import { RefundDetail } from '../../../../features/refunds/refund-detail';

export default async function StaffRefundPage({ params }: PageProps<'/staff/refunds/[refundId]'>) {
  const { refundId } = await params;
  return <RefundDetail basePath="/staff/refunds" refundId={refundId} />;
}
