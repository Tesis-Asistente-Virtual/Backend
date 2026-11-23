export class GetMonitoringInfo {
    execute() {
        return {
            purpose: 'longitudinal_monitoring',
            voluntary: true,
            consentRequired: true,
            automatedCollection: false,
            measurementsAvailable: false,
            trendsAvailable: false,
            clinicalAssessment: false,
        };
    }
}
