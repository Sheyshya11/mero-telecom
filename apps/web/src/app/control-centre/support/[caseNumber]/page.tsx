import { SupportCaseView } from '../../../../features/support/support-case-view';

export default async function ControlCentreSupportCasePage({
  params,
}: PageProps<'/control-centre/support/[caseNumber]'>) {
  const { caseNumber } = await params;
  return (
    <SupportCaseView basePath="/control-centre/support" caseNumber={caseNumber} mode="staff" />
  );
}
