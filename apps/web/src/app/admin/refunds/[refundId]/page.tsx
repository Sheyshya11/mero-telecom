import { RefundDetail } from '../../../../features/refunds/refund-detail';

export default async function AdminRefundPage({ params }: PageProps<'/admin/refunds/[refundId]'>) {
  const { refundId } = await params;
  return <RefundDetail basePath="/admin/refunds" refundId={refundId} />;
}
