/**
 * AUTO-GENERATED baseline of pre-existing drift between
 * lib/api-spec/openapi.yaml and lib/db/src/schema, captured when the
 * openapi-drift guard test was introduced. This list can only SHRINK:
 * regeneration intersects with the committed baseline, so new drift can
 * never be added here — fix the spec, or use the curated allowlists in
 * openapi-drift.test.ts for genuinely computed/omitted fields.
 *
 * Prune fixed entries with:
 *   UPDATE_OPENAPI_DRIFT_BASELINE=1 npx vitest run src/__tests__/openapi-drift.test.ts
 */

/** OpenAPI properties with no corresponding drizzle column. */
export const KNOWN_EXTRA_PROPERTIES: Record<string, string[]> = {
  "Applicant": [
    "firstName",
    "lastName",
    "currentEmployeeId",
    "resumeUrl",
    "notes"
  ],
  "Application": [
    "coverLetter"
  ],
  "AppraisalCompetencyRating": [
    "selfScore",
    "managerScore",
    "finalScore",
    "comments",
    "updatedAt"
  ],
  "AppraisalCycle": [
    "name",
    "startDate",
    "endDate",
    "reviewPeriodStart",
    "reviewPeriodEnd",
    "description"
  ],
  "AppraisalRecord": [
    "reviewerId",
    "selfRating",
    "managerRating",
    "selfComments",
    "hrComments",
    "submittedAt",
    "completedAt"
  ],
  "ApprovalDelegation": [
    "approvalTypes"
  ],
  "Approval": [
    "requestedByEmployeeNameEn",
    "assignedToUserName"
  ],
  "AttendanceDevice": [
    "departmentNameEn"
  ],
  "AttendanceRecord": [
    "employeeNameEn",
    "employeeNameAr",
    "departmentNameEn",
    "deviceName"
  ],
  "AuditLog": [
    "actorUserName"
  ],
  "BackgroundCheck": [
    "result",
    "notes"
  ],
  "BreakGlassAccess": [
    "userName"
  ],
  "CalibrationSession": [
    "facilitatorId",
    "updatedAt"
  ],
  "Certification": [
    "certName",
    "certNumber",
    "documentUrl",
    "notes"
  ],
  "ChainOfCommandEntry": [
    "employeeNameEn",
    "supervisorNameEn"
  ],
  "CommendationRecord": [
    "commendationDate",
    "commendationType",
    "description",
    "issuedBy",
    "notes",
    "updatedAt"
  ],
  "Competency": [
    "name",
    "description",
    "category",
    "maxScore",
    "updatedAt"
  ],
  "CompetencyFramework": [
    "name",
    "description"
  ],
  "CourseNomination": [
    "nominatedBy",
    "nominatedAt"
  ],
  "Department": [
    "parentNameEn",
    "headEmployeeNameEn",
    "employeeCount"
  ],
  "DeploymentEvent": [
    "packageId",
    "triggeredByUserId",
    "createdAt"
  ],
  "DevelopmentActivity": [
    "activityName",
    "description",
    "notes"
  ],
  "DevelopmentPlan": [
    "title",
    "description",
    "completionPercentage"
  ],
  "DisciplinaryRecord": [
    "incidentType",
    "severity",
    "description",
    "actionTaken",
    "issuedBy",
    "acknowledgedAt"
  ],
  "DocumentAccessLog": [
    "accessedBy",
    "accessType"
  ],
  "DocumentCategory": [
    "name",
    "description",
    "parentCategoryId"
  ],
  "DocumentTemplate": [
    "name",
    "description",
    "contentBody",
    "variables",
    "language",
    "createdBy"
  ],
  "DocumentVersion": [
    "uploadedBy"
  ],
  "Document": [
    "employeeNameEn",
    "uploadedByUserName"
  ],
  "DualAuthRequest": [
    "initiatedByUserName"
  ],
  "EmployeeGoal": [
    "title",
    "description",
    "completedAt"
  ],
  "EmployeeOnboarding": [
    "expectedEndDate",
    "actualEndDate",
    "completionPercentage",
    "assignedToId"
  ],
  "EmployeePosting": [
    "employeeNameEn",
    "orgUnitNameEn",
    "dutyStationNameEn",
    "rankNameEn"
  ],
  "EmployeeRequest": [
    "subject",
    "description",
    "priority",
    "assignedToId",
    "resolvedAt"
  ],
  "EmployeeSecondment": [
    "employeeNameEn",
    "hostUnitNameEn"
  ],
  "EmployeeSkill": [
    "yearsExperience",
    "lastUsedDate"
  ],
  "EmployeeTransfer": [
    "employeeNameEn",
    "fromUnitNameEn",
    "toUnitNameEn"
  ],
  "Employee": [
    "departmentNameEn",
    "departmentNameAr",
    "managerNameEn",
    "roleNameEn"
  ],
  "EmploymentContract": [
    "salary",
    "currency",
    "documentUrl"
  ],
  "EnterpriseDocument": [
    "title",
    "description",
    "storagePath",
    "fileSize",
    "mimeType",
    "createdBy"
  ],
  "EquipmentIssuance": [
    "itemName",
    "issuedDate",
    "returnedDate",
    "issuedBy"
  ],
  "GoalCycle": [
    "name",
    "description"
  ],
  "HealthCheck": [
    "durationMs"
  ],
  "IdCardRecord": [
    "issuedDate",
    "issuedBy",
    "updatedAt"
  ],
  "InstallationReadiness": [
    "checkName",
    "checkType",
    "message",
    "severity",
    "isRequired"
  ],
  "InterviewScore": [
    "interviewerId",
    "interviewDate",
    "notes"
  ],
  "JobOffer": [
    "offerDate",
    "expiryDate",
    "salary",
    "startDate",
    "notes",
    "respondedAt"
  ],
  "JobPosting": [
    "title",
    "description",
    "requirements",
    "location",
    "employmentType",
    "salaryMin",
    "salaryMax",
    "currency",
    "postedAt"
  ],
  "JobRequisition": [
    "title",
    "positionId",
    "requestedBy",
    "numberOfPositions",
    "requiredBy",
    "priority",
    "budgetApproved",
    "notes"
  ],
  "LeaveBalance": [
    "available",
    "employeeNameEn",
    "employeeNameAr",
    "leaveTypeNameEn",
    "leaveTypeNameAr",
    "leaveTypeColor"
  ],
  "LeaveDelegation": [
    "delegatorNameEn",
    "delegateeNameEn"
  ],
  "LeaveRequestDetail": [
    "employeeNameEn",
    "employeeNameAr",
    "departmentId",
    "leaveTypeNameEn",
    "leaveTypeNameAr",
    "leaveTypeColor",
    "leaveTypeCategory",
    "coveringEmployeeNameEn",
    "steps",
    "attachments"
  ],
  "LicenseRecord": [
    "daysUntilExpiry",
    "features"
  ],
  "MobilizationStatus": [
    "employeeNameEn",
    "employeeNameAr"
  ],
  "OnboardingTask": [
    "taskName",
    "taskDescription",
    "category",
    "completedBy"
  ],
  "OnboardingTemplateItem": [
    "taskName",
    "taskDescription",
    "category",
    "daysFromStart"
  ],
  "OnboardingTemplate": [
    "name",
    "description",
    "items"
  ],
  "OvertimeRule": [
    "deptNameEn",
    "deptNameAr"
  ],
  "PayrollRunDetail": [
    "employeeNameEn",
    "employeeNameAr",
    "employeeNumber",
    "jobTitleEn",
    "departmentNameEn",
    "grade",
    "jobTitleAr",
    "nationalId",
    "periodNameEn",
    "periodNameAr",
    "periodStartDate",
    "periodEndDate",
    "payDate",
    "lines"
  ],
  "PayrollVarianceLog": [
    "periodCode",
    "periodNameEn",
    "startDate"
  ],
  "ProbationRecord": [
    "extensionDate",
    "reviewDate",
    "reviewedBy",
    "notes"
  ],
  "PromotionRecommendation": [
    "recommendedBy",
    "currentPositionId",
    "recommendedPositionId",
    "justification",
    "reviewedBy"
  ],
  "PunchEvent": [
    "firstNameEn",
    "lastNameEn",
    "firstNameAr",
    "lastNameAr",
    "employeeNumber",
    "deviceName",
    "deviceLocation"
  ],
  "ReportDefinition": [
    "name",
    "description",
    "queryTemplate",
    "availableColumns",
    "createdBy"
  ],
  "ReportOutput": [
    "exportFormat",
    "fileSize",
    "generatedAt",
    "updatedAt"
  ],
  "ReportSchedule": [
    "scheduleName",
    "cronExpression",
    "recipients",
    "filtersJson",
    "createdBy"
  ],
  "Role": [
    "permissions",
    "userCount"
  ],
  "RosterEntry": [
    "firstNameEn",
    "lastNameEn",
    "firstNameAr",
    "lastNameAr",
    "employeeNumber",
    "jobTitleEn",
    "jobTitleAr",
    "shiftCode",
    "shiftNameEn",
    "shiftNameAr",
    "shiftStartTime",
    "shiftEndTime",
    "shiftColor"
  ],
  "SavedReportFilter": [
    "filterName"
  ],
  "SecurityAlert": [
    "acknowledgedByUserName"
  ],
  "SecurityClearance": [
    "employeeNameEn",
    "employeeNameAr"
  ],
  "Shift": [
    "assignedEmployeeCount"
  ],
  "SuccessionCandidate": [
    "assessmentScore",
    "targetDate",
    "status",
    "notes"
  ],
  "SuccessionPool": [
    "name",
    "targetPositionId",
    "description"
  ],
  "SystemUser": [
    "roleNameEn"
  ],
  "TrainingAttendance": [
    "attendanceDate",
    "status",
    "hoursAttended"
  ],
  "TrainingCourse": [
    "name",
    "description",
    "category"
  ],
  "TrainingProgram": [
    "name",
    "description",
    "updatedAt"
  ],
  "TrainingSession": [
    "sessionName",
    "trainer"
  ],
  "UpdatePackage": [
    "version",
    "description",
    "fileSize",
    "isVerified",
    "installedBy"
  ]
};

/** Drizzle columns absent from the OpenAPI schema. */
export const KNOWN_MISSING_PROPERTIES: Record<string, string[]> = {
  "Applicant": [
    "employeeId",
    "firstNameEn",
    "lastNameEn",
    "firstNameAr",
    "lastNameAr",
    "nationalId",
    "nationality",
    "gender",
    "dateOfBirth",
    "currentEmployer",
    "currentTitle",
    "totalExperienceYears",
    "highestEducation",
    "resumeDocumentId",
    "referredByEmployeeId",
    "isActive"
  ],
  "Application": [
    "applicationNumber",
    "coverLetterText",
    "screeningScore",
    "interviewScore",
    "overallRating",
    "rejectedAt",
    "shortlistedAt",
    "shortlistedByUserId",
    "currentInterviewRound",
    "backgroundCheckId",
    "offerId",
    "isInternalApplicant",
    "assignedRecruiterId"
  ],
  "AppraisalCompetencyRating": [
    "raterType",
    "score",
    "notes"
  ],
  "AppraisalCycle": [
    "nameEn",
    "nameAr",
    "goalCycleId",
    "competencyFrameworkId",
    "year",
    "appraisalType",
    "selfAppraisalDeadline",
    "managerAppraisalDeadline",
    "calibrationDeadline",
    "goalsWeight",
    "competenciesWeight",
    "isActive"
  ],
  "AppraisalRecord": [
    "reviewerEmployeeId",
    "selfGoalsScore",
    "selfCompetencyScore",
    "selfOverallScore",
    "selfStrengths",
    "selfDevelopmentAreas",
    "selfSubmittedAt",
    "managerGoalsScore",
    "managerCompetencyScore",
    "managerOverallScore",
    "managerStrengths",
    "managerDevelopmentAreas",
    "managerSubmittedAt",
    "calibratedScore",
    "calibrationNotes",
    "calibratedAt",
    "calibratedByUserId",
    "sharedWithEmployeeAt",
    "employeeAcknowledgedAt",
    "employeeResponse",
    "promotionRecommended"
  ],
  "ApprovalDelegation": [
    "delegationType",
    "approvedByUserId",
    "revokedAt"
  ],
  "AttendanceRecord": [
    "createdAt"
  ],
  "BackgroundCheck": [
    "applicantId",
    "referenceNumber",
    "expiryDate",
    "resultSummary",
    "flagNotes",
    "reviewedByUserId",
    "reviewedAt",
    "reviewNotes",
    "isWaived",
    "waivedByUserId",
    "waivedReason",
    "documentId"
  ],
  "BackupRecord": [
    "verifiedByUserId",
    "verificationNotes",
    "restoreTestedAt",
    "initiatedByUserId",
    "notes",
    "createdAt"
  ],
  "BranchServer": [
    "licenseKeyHash",
    "notes",
    "updatedAt"
  ],
  "BreakGlassAccess": [
    "emergencyCode",
    "revokedByUserId",
    "revocationReason",
    "reviewedAt",
    "reviewedByUserId",
    "reviewNotes",
    "notifiedAt"
  ],
  "CalibrationSession": [
    "facilitatorUserId",
    "attendeesJson"
  ],
  "Certification": [
    "courseId",
    "sessionId",
    "certificationName",
    "certificationNumber",
    "renewalReminderSent",
    "documentId",
    "verificationUrl"
  ],
  "ChainOfCommandEntry": [
    "updatedAt"
  ],
  "CommendationRecord": [
    "awardType",
    "titleEn",
    "titleAr",
    "descriptionEn",
    "awardDate",
    "nominatedByEmployeeId",
    "approvedByEmployeeId",
    "approvedAt",
    "promotionPoints",
    "documentId",
    "isPublic"
  ],
  "Competency": [
    "codeEn",
    "nameEn",
    "nameAr",
    "descriptionEn",
    "level1En",
    "level2En",
    "level3En",
    "level4En",
    "level5En",
    "weight",
    "sortOrder",
    "isActive"
  ],
  "CompetencyFramework": [
    "nameEn",
    "nameAr",
    "descriptionEn",
    "frameworkType",
    "applicableTo",
    "organizationType",
    "version"
  ],
  "CourseNomination": [
    "nominationSource",
    "nominatedByEmployeeId",
    "approvedByUserId",
    "rejectionReason",
    "isMandatory"
  ],
  "DeploymentEvent": [
    "performedByUserId",
    "performedBySystem",
    "errorMessage",
    "durationMs",
    "previousValue",
    "newValue"
  ],
  "DevelopmentActivity": [
    "titleEn",
    "targetCompetencyId",
    "courseId",
    "completionNotes",
    "sortOrder"
  ],
  "DevelopmentPlan": [
    "cycleId",
    "successionCandidateId",
    "nameEn",
    "targetCompetencies",
    "approvedByEmployeeId",
    "approvedAt",
    "completionPct",
    "notes"
  ],
  "DisciplinaryRecord": [
    "actionType",
    "actionDate",
    "descriptionEn",
    "descriptionAr",
    "category",
    "expiryDate",
    "issuedByEmployeeId",
    "hrApprovedByUserId",
    "employeeAcknowledged",
    "employeeAcknowledgedAt",
    "employeeResponse",
    "appealDate",
    "appealOutcome",
    "documentId",
    "requiresDualAuth",
    "dualAuthRequestId"
  ],
  "DocumentAccessLog": [
    "versionId",
    "userId",
    "employeeId",
    "action",
    "wasWatermarked",
    "outcome",
    "denialReason"
  ],
  "DocumentAcknowledgement": [
    "status",
    "declinedAt",
    "declineReason",
    "deadlineDate",
    "reminderSentAt",
    "createdAt"
  ],
  "DocumentCategory": [
    "code",
    "nameEn",
    "nameAr",
    "descriptionEn",
    "categoryType",
    "defaultClassification",
    "retentionYears",
    "retentionAction",
    "allowDownload",
    "allowPrint",
    "requiresAcknowledgement",
    "watermarkOnDownload",
    "watermarkText",
    "requiresExpiryDate",
    "uploadRoles",
    "viewRoles",
    "sortOrder",
    "organizationType"
  ],
  "DocumentTemplate": [
    "code",
    "nameEn",
    "nameAr",
    "bodyHtml",
    "bodyHtmlAr",
    "mergeFieldsJson",
    "headerImagePath",
    "footerText",
    "footerTextAr",
    "categoryId",
    "organizationType"
  ],
  "DocumentVersion": [
    "fileName",
    "checksum",
    "uploadedByUserId",
    "uploadedAt",
    "isCurrentVersion"
  ],
  "DualAuthRequest": [
    "firstApproverNotes",
    "secondApproverNotes",
    "rejectedByUserId",
    "payloadJson",
    "updatedAt"
  ],
  "DutyStation": [
    "updatedAt"
  ],
  "EmployeeGoal": [
    "titleEn",
    "titleAr",
    "descriptionEn",
    "goalType",
    "targetUnit",
    "progressStatus",
    "completionPct",
    "finalScore",
    "managerScore",
    "approvedByEmployeeId",
    "approvedAt",
    "linkedOrgObjective",
    "notes"
  ],
  "EmployeeOnboarding": [
    "contractId",
    "targetCompletionDate",
    "completedAt",
    "completionPct",
    "hrOwnerUserId",
    "managerEmployeeId"
  ],
  "EmployeePosting": [
    "remarksAr",
    "updatedAt"
  ],
  "EmployeeRequest": [
    "requestNumber",
    "titleEn",
    "descriptionEn",
    "addressedTo",
    "purposeEn",
    "reviewedByUserId",
    "reviewedAt",
    "rejectionReason",
    "fulfilledAt",
    "generatedDocumentId",
    "urgency",
    "requiredByDate"
  ],
  "EmployeeSecondment": [
    "purposeAr",
    "approvedByEmployeeId",
    "approvedAt",
    "dualAuthRequestId",
    "hostContactName",
    "hostContactEmail",
    "updatedAt"
  ],
  "EmployeeSkill": [
    "assessmentMethod",
    "lastAssessedAt"
  ],
  "EmployeeTransfer": [
    "orderDate",
    "reasonAr",
    "initiatedByUserId",
    "approvedAt",
    "dualAuthRequestId",
    "remarksEn",
    "updatedAt"
  ],
  "EmploymentContract": [
    "contractNumber",
    "applicantId",
    "offerId",
    "probationEndDate",
    "sentAt",
    "signedByApplicant",
    "signedByOrg",
    "orgSignatoryEmployeeId",
    "documentId",
    "terminationDate",
    "terminationReason",
    "preparedByUserId"
  ],
  "EnterpriseDocument": [
    "documentNumber",
    "orgUnitId",
    "titleEn",
    "titleAr",
    "descriptionEn",
    "currentVersionId",
    "currentVersionNumber",
    "issuedAt",
    "expiryAlertSentAt",
    "legalHoldPlacedAt",
    "legalHoldPlacedByUserId",
    "allowDownloadOverride",
    "allowPrintOverride",
    "watermarkOverride",
    "retentionExpiresAt",
    "requiresAcknowledgement",
    "acknowledgedCount",
    "tagsJson",
    "uploadedByUserId"
  ],
  "EquipmentIssuance": [
    "onboardingId",
    "itemDescription",
    "assetTag",
    "issuedAt",
    "issuedByUserId",
    "returnedAt",
    "returnedByEmployeeId",
    "receivedByUserId",
    "employeeSignature"
  ],
  "GoalCycle": [
    "nameEn",
    "nameAr",
    "cycleType",
    "year",
    "goalSettingDeadline",
    "midYearReviewDate",
    "isActive"
  ],
  "HealthCheck": [
    "checkName",
    "responseTimeMs",
    "triggeredBy"
  ],
  "IdCardRecord": [
    "cardType",
    "issuedAt",
    "replacedByCardId",
    "replacementReason",
    "issuedByUserId",
    "revokedAt"
  ],
  "InstallationReadiness": [
    "checkCategory",
    "checkItemEn",
    "checkItemAr",
    "resultMessage",
    "isMandatory",
    "sortOrder"
  ],
  "InterviewScore": [
    "interviewerEmployeeId",
    "roundNumber",
    "roundType",
    "scheduledAt",
    "conductedAt",
    "status",
    "durationMinutes",
    "leadershipScore",
    "strengthsNotes",
    "concernsNotes",
    "generalNotes",
    "isSubmitted",
    "submittedAt",
    "meetingLocation",
    "interviewMode"
  ],
  "JobOffer": [
    "offerNumber",
    "applicantId",
    "jobPostingId",
    "jobTitleEn",
    "jobTitleAr",
    "departmentId",
    "gradeCode",
    "baseSalary",
    "housingAllowance",
    "transportAllowance",
    "totalPackage",
    "employmentType",
    "proposedStartDate",
    "probationMonths",
    "offerValidUntil",
    "acceptedAt",
    "declinedAt",
    "signedDocumentId",
    "preparedByUserId",
    "approvedByEmployeeId",
    "approvedAt",
    "specialConditions"
  ],
  "JobPosting": [
    "postingCode",
    "titleEn",
    "titleAr",
    "descriptionEn",
    "descriptionAr",
    "requirementsEn",
    "qualificationsEn",
    "visibility",
    "publishedAt",
    "applicationCount",
    "dutyStationId",
    "postedByUserId",
    "isActive"
  ],
  "JobRequisition": [
    "requisitionNumber",
    "orgUnitId",
    "jobTitleEn",
    "jobTitleAr",
    "jobDescriptionEn",
    "gradeCode",
    "headcount",
    "requisitionType",
    "sourcingStrategy",
    "employmentType",
    "budgetedSalaryMin",
    "budgetedSalaryMax",
    "currency",
    "targetStartDate",
    "requestedByEmployeeId",
    "approvedByEmployeeId",
    "approvedAt",
    "rejectionReason",
    "closedAt",
    "organizationType"
  ],
  "LeaveApprovalStep": [
    "createdAt"
  ],
  "LeaveBalance": [
    "updatedAt"
  ],
  "LeaveRequestDetail": [
    "halfDayPeriod",
    "updatedAt"
  ],
  "LeaveType": [
    "updatedAt"
  ],
  "LicenseRecord": [
    "validationNotes",
    "updatedAt"
  ],
  "MilitaryRank": [
    "updatedAt"
  ],
  "MobilizationStatus": [
    "updatedByUserId",
    "approvedByEmployeeId",
    "isActive",
    "createdAt"
  ],
  "OnboardingTask": [
    "templateItemId",
    "titleEn",
    "titleAr",
    "ownerRole",
    "taskType",
    "completedByUserId",
    "isRequired",
    "sortOrder"
  ],
  "OnboardingTemplateItem": [
    "titleEn",
    "titleAr",
    "descriptionEn",
    "ownerRole",
    "taskType",
    "dueDayOffset"
  ],
  "OnboardingTemplate": [
    "nameEn",
    "nameAr",
    "descriptionEn",
    "targetEmploymentType",
    "organizationType",
    "departmentId",
    "totalTasks",
    "estimatedDays",
    "isDefault"
  ],
  "OrgUnit": [
    "updatedAt"
  ],
  "PayComponent": [
    "updatedAt"
  ],
  "PayrollPeriod": [
    "firstApprovedBy",
    "firstApproverNote",
    "secondApprovedBy",
    "secondApproverNote",
    "updatedAt"
  ],
  "PayrollRunDetail": [
    "salaryGradeId",
    "createdAt",
    "updatedAt"
  ],
  "ProbationRecord": [
    "contractId",
    "extendedEndDate",
    "midReviewDate",
    "midReviewConductedAt",
    "midReviewScore",
    "midReviewNotes",
    "midReviewByEmployeeId",
    "finalReviewConductedAt",
    "finalReviewScore",
    "finalReviewNotes",
    "finalReviewByEmployeeId",
    "outcomeDate",
    "outcomeNotes",
    "confirmationLetterSent",
    "confirmationLetterSentAt"
  ],
  "PromotionRecommendation": [
    "appraisalId",
    "currentGradeCode",
    "recommendedGradeCode",
    "currentRankCode",
    "recommendedRankCode",
    "recommendationDate",
    "justificationEn",
    "reviewedByEmployeeId",
    "requiresDualAuth",
    "dualAuthRequestId"
  ],
  "PunchEvent": [
    "rawPayload"
  ],
  "ReportDefinition": [
    "code",
    "nameEn",
    "nameAr",
    "descriptionEn",
    "outputFormat",
    "querySpecJson",
    "allowedRoles",
    "maskedFieldsJson",
    "supportedExports",
    "supportsArabic",
    "supportsEnglish",
    "organizationType",
    "createdByUserId"
  ],
  "ReportOutput": [
    "scheduleId",
    "parametersJson",
    "outputFormat",
    "language",
    "fileName",
    "fileSizeBytes",
    "generationStartedAt",
    "generationCompletedAt",
    "expiresAt",
    "downloadCount"
  ],
  "ReportSchedule": [
    "savedFilterId",
    "nameEn",
    "frequency",
    "dayOfMonth",
    "dayOfWeek",
    "timeOfDay",
    "language",
    "outputPath",
    "notifyUserIdsJson",
    "lastRunStatus",
    "createdByUserId"
  ],
  "Role": [
    "permissionsJson"
  ],
  "RosterEntry": [
    "createdByUserId",
    "createdAt",
    "updatedAt"
  ],
  "SalaryGrade": [
    "updatedAt"
  ],
  "SavedReportFilter": [
    "nameEn",
    "isShared"
  ],
  "SecurityClearance": [
    "reviewedByUserId",
    "suspensionReason",
    "updatedAt"
  ],
  "SuccessionCandidate": [
    "talentScore",
    "performanceRating",
    "flightRisk",
    "impactIfLost",
    "futureIntent",
    "addedAt",
    "addedByUserId",
    "lastReviewedAt",
    "reviewNotes",
    "isActive"
  ],
  "SuccessionPool": [
    "nameEn",
    "nameAr",
    "descriptionEn",
    "targetJobTitleEn",
    "targetGradeCode",
    "targetRankCode",
    "poolType",
    "organizationType",
    "ownedByEmployeeId"
  ],
  "SyncQueueEntry": [
    "maxRetries",
    "resolvedByUserId",
    "updatedAt"
  ],
  "SystemUser": [
    "mustChangePassword"
  ],
  "TrainingAttendance": [
    "nominationId",
    "attendanceStatus",
    "attendancePct",
    "assessmentScore",
    "passed",
    "completedAt",
    "certificateIssued",
    "certificateIssuedAt",
    "recordedByUserId"
  ],
  "TrainingCourse": [
    "codeEn",
    "nameEn",
    "nameAr",
    "descriptionEn",
    "deliveryMode",
    "providerType",
    "providerName",
    "costPerPerson",
    "currency",
    "grantsCertification",
    "certificationValidMonths",
    "prerequisitesEn"
  ],
  "TrainingProgram": [
    "codeEn",
    "nameEn",
    "nameAr",
    "descriptionEn",
    "organizationType"
  ],
  "TrainingSession": [
    "sessionCode",
    "startTime",
    "endTime",
    "dutyStationId",
    "trainerName",
    "trainerEmployeeId",
    "maxParticipants",
    "attendedCount",
    "passingScore"
  ],
  "UpdatePackage": [
    "packageVersion",
    "releaseNotesAr",
    "signatureB64",
    "signedByKeyId",
    "signatureVerified",
    "fileSizeBytes",
    "isCritical",
    "requiresRestart",
    "minCompatibleVersion",
    "installedByUserId",
    "rollbackVersion"
  ]
};
