export class GetMonitoringInfo {
  execute() {
    return {
      purpose: 'longitudinal_monitoring' as const,
      voluntary: true,
      consentRequired: true,
      automatedCollection: false,
      measurementsAvailable: false,
      trendsAvailable: false,
      clinicalAssessment: false,
    };
  }
}
