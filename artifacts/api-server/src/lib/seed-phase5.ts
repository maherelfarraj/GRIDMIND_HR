/**
 * Phase 5 seed — Recruitment, Onboarding, Performance, Training, Succession & Self-Service.
 * Run with: npx tsx artifacts/api-server/src/lib/seed-phase5.ts
 */
import { db } from "@workspace/db";
import {
  jobRequisitionsTable, jobPostingsTable, applicantsTable, applicationsTable,
  interviewScoresTable, backgroundChecksTable, jobOffersTable, employmentContractsTable,
  onboardingTemplatesTable, onboardingTemplateItemsTable, employeeOnboardingTable, onboardingTasksTable,
  probationRecordsTable, equipmentIssuancesTable, idCardRecordsTable,
  competencyFrameworksTable, competenciesTable,
  goalCyclesTable, employeeGoalsTable,
  appraisalCyclesTable, appraisalRecordsTable, appraisalCompetencyRatingsTable, calibrationSessionsTable,
  disciplinaryRecordsTable, commendationRecordsTable, promotionRecommendationsTable,
  trainingProgramsTable, trainingCoursesTable, trainingSessionsTable, courseNominationsTable,
  trainingAttendanceTable, certificationsTable, employeeSkillsTable,
  successionPoolsTable, successionCandidatesTable, developmentPlansTable, developmentActivitiesTable,
  employeeRequestsTable, announcementsTable, approvalDelegationsTable,
} from "@workspace/db";

async function main() {
  console.log("🌱 Seeding Phase 5...");

  // ─── DELETE in reverse FK dependency order ────────────────────────────────
  console.log("  → cleaning phase 5 tables");

  // Self-service
  await db.delete(approvalDelegationsTable);
  await db.delete(announcementsTable);
  await db.delete(employeeRequestsTable);

  // Succession & development
  await db.delete(developmentActivitiesTable);
  await db.delete(developmentPlansTable);
  await db.delete(successionCandidatesTable);
  await db.delete(successionPoolsTable);

  // Skills & certifications
  await db.delete(employeeSkillsTable);
  await db.delete(certificationsTable);

  // Training attendance & nominations
  await db.delete(trainingAttendanceTable);
  await db.delete(courseNominationsTable);
  await db.delete(trainingSessionsTable);
  await db.delete(trainingCoursesTable);
  await db.delete(trainingProgramsTable);

  // Performance / appraisals
  await db.delete(promotionRecommendationsTable);
  await db.delete(commendationRecordsTable);
  await db.delete(disciplinaryRecordsTable);
  await db.delete(calibrationSessionsTable);
  await db.delete(appraisalCompetencyRatingsTable);
  await db.delete(appraisalRecordsTable);
  await db.delete(appraisalCyclesTable);
  await db.delete(employeeGoalsTable);
  await db.delete(goalCyclesTable);
  await db.delete(competenciesTable);
  await db.delete(competencyFrameworksTable);

  // Equipment / ID cards
  await db.delete(idCardRecordsTable);
  await db.delete(equipmentIssuancesTable);

  // Probation
  await db.delete(probationRecordsTable);

  // Onboarding tasks & records
  await db.delete(onboardingTasksTable);
  await db.delete(employeeOnboardingTable);
  await db.delete(onboardingTemplateItemsTable);
  await db.delete(onboardingTemplatesTable);

  // Recruitment
  await db.delete(employmentContractsTable);
  await db.delete(jobOffersTable);
  await db.delete(backgroundChecksTable);
  await db.delete(interviewScoresTable);
  await db.delete(applicationsTable);
  await db.delete(applicantsTable);
  await db.delete(jobPostingsTable);
  await db.delete(jobRequisitionsTable);

  // ─── JOB REQUISITIONS ────────────────────────────────────────────────────
  console.log("  → job_requisitions");
  const [req1, req2, req3] = await db.insert(jobRequisitionsTable).values([
    {
      requisitionNumber: "REQ-2026-001",
      departmentId: 1,
      jobTitleEn: "Senior HR Specialist",
      jobTitleAr: "أخصائي موارد بشرية أول",
      jobDescriptionEn: "Lead and coordinate human resources activities including recruitment, employee relations, and policy implementation.",
      headcount: 2,
      requisitionType: "new_headcount",
      sourcingStrategy: "both",
      employmentType: "full_time",
      budgetedSalaryMin: "15000",
      budgetedSalaryMax: "22000",
      targetStartDate: "2026-09-01",
      justification: "Expansion of HR Directorate to support growth in headcount.",
      status: "approved",
      requestedByEmployeeId: 1,
      approvedByEmployeeId: 1,
      approvedAt: new Date("2026-05-15"),
      organizationType: "commercial",
    },
    {
      requisitionNumber: "REQ-2026-002",
      departmentId: 5,
      jobTitleEn: "Intelligence Officer",
      jobTitleAr: "ضابط استخبارات",
      jobDescriptionEn: "Conduct intelligence analysis and produce tactical assessments for operational planning.",
      headcount: 1,
      requisitionType: "replacement",
      sourcingStrategy: "internal",
      employmentType: "full_time",
      targetStartDate: "2026-10-01",
      justification: "Replacement of officer retiring in Q3 2026.",
      status: "approved",
      requestedByEmployeeId: 3,
      approvedByEmployeeId: 1,
      approvedAt: new Date("2026-05-20"),
      organizationType: "military",
    },
    {
      requisitionNumber: "REQ-2026-003",
      departmentId: 4,
      jobTitleEn: "Supply Chain Analyst",
      jobTitleAr: "محلل سلسلة الإمداد",
      jobDescriptionEn: "Analyze and optimize supply chain processes including procurement, inventory management and logistics.",
      headcount: 1,
      requisitionType: "new_headcount",
      sourcingStrategy: "external",
      employmentType: "full_time",
      budgetedSalaryMin: "10000",
      budgetedSalaryMax: "16000",
      targetStartDate: "2026-11-01",
      justification: "Increased logistics workload requires additional analytical capacity.",
      status: "submitted",
      requestedByEmployeeId: 9,
      organizationType: "commercial",
    },
  ]).returning();

  // ─── JOB POSTINGS ────────────────────────────────────────────────────────
  console.log("  → job_postings");
  const [posting1, posting2] = await db.insert(jobPostingsTable).values([
    {
      postingCode: "POST-2026-001",
      requisitionId: req1.id,
      titleEn: "Senior HR Specialist",
      titleAr: "أخصائي موارد بشرية أول",
      descriptionEn: "We are seeking an experienced Senior HR Specialist to join the HR Directorate. The successful candidate will lead recruitment drives, manage employee relations, and contribute to policy development.",
      requirementsEn: "Bachelor's degree in Human Resources or related field. Minimum 5 years HR experience. Proficiency in SAP HCM preferred.",
      visibility: "both",
      publishedAt: new Date("2026-06-01"),
      closingDate: "2026-08-31",
      status: "published",
      applicationCount: 0,
      departmentId: 1,
      postedByUserId: 1,
      isActive: true,
    },
    {
      postingCode: "POST-2026-002",
      requisitionId: req2.id,
      titleEn: "Intelligence Officer",
      titleAr: "ضابط استخبارات",
      descriptionEn: "The Intelligence Directorate invites applications from qualified military officers for the position of Intelligence Officer. Applicants must hold a valid security clearance.",
      requirementsEn: "Active military commission. Minimum rank of Captain. Security clearance at Secret level or above. Prior intelligence or analytical role preferred.",
      visibility: "internal",
      publishedAt: new Date("2026-06-10"),
      closingDate: "2026-09-15",
      status: "published",
      applicationCount: 0,
      departmentId: 5,
      postedByUserId: 1,
      isActive: true,
    },
  ]).returning();

  // ─── APPLICANTS ──────────────────────────────────────────────────────────
  console.log("  → applicants");
  const [app1Person, app2Person, app3Person, app4Person, app5Person] = await db.insert(applicantsTable).values([
    {
      firstNameEn: "Khalid",
      lastNameEn: "Al-Rashidi",
      firstNameAr: "خالد",
      lastNameAr: "الراشدي",
      email: "khalid.rashidi@email.com",
      phone: "+966501234567",
      nationality: "Saudi",
      gender: "male",
      applicantType: "external",
      currentEmployer: "National HR Solutions Ltd.",
      currentTitle: "HR Specialist",
      totalExperienceYears: 7,
      highestEducation: "bachelor",
      source: "portal",
    },
    {
      firstNameEn: "Noura",
      lastNameEn: "Al-Qahtani",
      firstNameAr: "نورة",
      lastNameAr: "القحطاني",
      email: "noura.qahtani@email.com",
      phone: "+966502345678",
      nationality: "Saudi",
      gender: "female",
      applicantType: "external",
      currentEmployer: "Riyadh Talent Agency",
      currentTitle: "HR Coordinator",
      totalExperienceYears: 5,
      highestEducation: "bachelor",
      source: "agency",
    },
    {
      firstNameEn: "Omar",
      lastNameEn: "Al-Ghamdi",
      firstNameAr: "عمر",
      lastNameAr: "الغامدي",
      email: "omar.ghamdi@rafhrms.sa",
      phone: "+966503456789",
      nationality: "Saudi",
      gender: "male",
      applicantType: "internal",
      employeeId: 6,
      currentTitle: "Operations Planning Officer",
      totalExperienceYears: 6,
      highestEducation: "bachelor",
      source: "direct",
    },
    {
      firstNameEn: "Tariq",
      lastNameEn: "Al-Harbi",
      firstNameAr: "طارق",
      lastNameAr: "الحربي",
      email: "tariq.harbi@email.com",
      phone: "+966504567890",
      nationality: "Saudi",
      gender: "male",
      applicantType: "external",
      currentTitle: "Intelligence Analyst",
      totalExperienceYears: 9,
      highestEducation: "master",
      source: "referral",
    },
    {
      firstNameEn: "Fatima",
      lastNameEn: "Al-Dosari",
      firstNameAr: "فاطمة",
      lastNameAr: "الدوسري",
      email: "fatima.dosari@email.com",
      phone: "+966505678901",
      nationality: "Saudi",
      gender: "female",
      applicantType: "external",
      currentEmployer: "Gulf Human Capital Consulting",
      currentTitle: "HR Business Partner",
      totalExperienceYears: 6,
      highestEducation: "bachelor",
      source: "portal",
    },
  ]).returning();

  // ─── APPLICATIONS ─────────────────────────────────────────────────────────
  console.log("  → applications");
  const [appRec1, appRec2, appRec3, appRec4, appRec5] = await db.insert(applicationsTable).values([
    {
      applicationNumber: "APP-2026-001",
      jobPostingId: posting1.id,
      applicantId: app1Person.id,
      status: "interviewing",
      currentInterviewRound: 2,
      screeningScore: 82,
      isInternalApplicant: false,
    },
    {
      applicationNumber: "APP-2026-002",
      jobPostingId: posting1.id,
      applicantId: app2Person.id,
      status: "shortlisted",
      currentInterviewRound: 0,
      screeningScore: 76,
      shortlistedAt: new Date("2026-07-01"),
      shortlistedByUserId: 1,
      isInternalApplicant: false,
    },
    {
      applicationNumber: "APP-2026-003",
      jobPostingId: posting1.id,
      applicantId: app3Person.id,
      status: "offer_extended",
      currentInterviewRound: 2,
      screeningScore: 90,
      isInternalApplicant: true,
      notes: "Internal candidate — strong performance record in Operations Directorate.",
    },
    {
      applicationNumber: "APP-2026-004",
      jobPostingId: posting2.id,
      applicantId: app4Person.id,
      status: "interviewing",
      currentInterviewRound: 1,
      screeningScore: 88,
      isInternalApplicant: false,
    },
    {
      applicationNumber: "APP-2026-005",
      jobPostingId: posting1.id,
      applicantId: app5Person.id,
      status: "rejected",
      currentInterviewRound: 0,
      screeningScore: 58,
      rejectionReason: "Candidate did not meet minimum experience requirements.",
      rejectedAt: new Date("2026-07-10"),
      isInternalApplicant: false,
    },
  ]).returning();

  // ─── INTERVIEW SCORES ────────────────────────────────────────────────────
  console.log("  → interview_scores");
  await db.insert(interviewScoresTable).values([
    {
      applicationId: appRec1.id,
      interviewerEmployeeId: 1,
      roundNumber: 1,
      roundType: "hr_screen",
      status: "completed",
      conductedAt: new Date("2026-07-05T10:00:00"),
      durationMinutes: 45,
      technicalScore: 4,
      communicationScore: 4,
      overallScore: 4,
      recommendation: "yes",
      strengthsNotes: "Strong HR background and clear communication.",
      isSubmitted: true,
      submittedAt: new Date("2026-07-05T11:00:00"),
      interviewMode: "in_person",
    },
    {
      applicationId: appRec1.id,
      interviewerEmployeeId: 2,
      roundNumber: 2,
      roundType: "competency",
      status: "completed",
      conductedAt: new Date("2026-07-12T14:00:00"),
      durationMinutes: 60,
      technicalScore: 3,
      communicationScore: 5,
      leadershipScore: 4,
      overallScore: 4,
      recommendation: "yes",
      strengthsNotes: "Excellent communication and people skills.",
      concernsNotes: "Could improve technical depth in HR systems.",
      isSubmitted: true,
      submittedAt: new Date("2026-07-12T15:30:00"),
      interviewMode: "in_person",
    },
    {
      applicationId: appRec4.id,
      interviewerEmployeeId: 3,
      roundNumber: 1,
      roundType: "panel",
      status: "completed",
      conductedAt: new Date("2026-07-08T09:00:00"),
      durationMinutes: 90,
      technicalScore: 5,
      communicationScore: 4,
      leadershipScore: 5,
      overallScore: 5,
      recommendation: "strong_yes",
      strengthsNotes: "Exceptional tactical knowledge and leadership presence. Outstanding candidate.",
      isSubmitted: true,
      submittedAt: new Date("2026-07-08T11:00:00"),
      interviewMode: "in_person",
    },
    {
      applicationId: appRec4.id,
      interviewerEmployeeId: 7,
      roundNumber: 1,
      roundType: "panel",
      status: "completed",
      conductedAt: new Date("2026-07-08T09:00:00"),
      durationMinutes: 90,
      technicalScore: 4,
      communicationScore: 3,
      overallScore: 4,
      recommendation: "yes",
      strengthsNotes: "Good technical skills and sound analytical background.",
      concernsNotes: "Written communication could be stronger.",
      isSubmitted: true,
      submittedAt: new Date("2026-07-08T11:30:00"),
      interviewMode: "in_person",
    },
  ]);

  // ─── BACKGROUND CHECKS ───────────────────────────────────────────────────
  console.log("  → background_checks");
  const [bgCheck1] = await db.insert(backgroundChecksTable).values([
    {
      applicationId: appRec1.id,
      applicantId: app1Person.id,
      checkType: "full",
      status: "passed",
      provider: "National Background Verification Authority",
      referenceNumber: "NBVA-2026-4421",
      initiatedAt: new Date("2026-06-20"),
      completedAt: new Date("2026-07-01"),
      expiryDate: "2027-07-01",
      resultSummary: "All checks passed. No adverse findings.",
      reviewedByUserId: 1,
      reviewedAt: new Date("2026-07-02"),
    },
    {
      applicationId: appRec4.id,
      applicantId: app4Person.id,
      checkType: "security_clearance",
      status: "in_progress",
      provider: "Military Security General Directorate",
      referenceNumber: "MSGD-SC-2026-0089",
      initiatedAt: new Date("2026-07-10"),
    },
  ]).returning();

  // ─── JOB OFFERS ──────────────────────────────────────────────────────────
  console.log("  → job_offers");
  const [offer1] = await db.insert(jobOffersTable).values([
    {
      offerNumber: "OFR-2026-001",
      applicationId: appRec3.id,
      applicantId: app3Person.id,
      jobPostingId: posting1.id,
      jobTitleEn: "Senior HR Specialist",
      jobTitleAr: "أخصائي موارد بشرية أول",
      departmentId: 1,
      gradeCode: "G8",
      baseSalary: "18000",
      housingAllowance: "5000",
      transportAllowance: "1000",
      totalPackage: "24000",
      currency: "SAR",
      employmentType: "full_time",
      proposedStartDate: "2026-09-01",
      probationMonths: 3,
      offerValidUntil: "2026-08-01",
      status: "accepted",
      sentAt: new Date("2026-07-10"),
      acceptedAt: new Date("2026-07-15"),
      preparedByUserId: 1,
      approvedByEmployeeId: 1,
      approvedAt: new Date("2026-07-09"),
    },
  ]).returning();

  // ─── EMPLOYMENT CONTRACTS ─────────────────────────────────────────────────
  console.log("  → employment_contracts");
  await db.insert(employmentContractsTable).values([
    {
      contractNumber: "CTR-2026-001",
      applicantId: app3Person.id,
      offerId: offer1.id,
      contractType: "indefinite",
      startDate: "2026-09-01",
      probationEndDate: "2026-12-01",
      status: "signed",
      sentAt: new Date("2026-07-20"),
      signedAt: new Date("2026-07-25"),
      signedByApplicant: true,
      signedByOrg: true,
      orgSignatoryEmployeeId: 1,
      preparedByUserId: 1,
    },
  ]);

  // ─── ONBOARDING TEMPLATES ─────────────────────────────────────────────────
  console.log("  → onboarding_templates");
  const [template1] = await db.insert(onboardingTemplatesTable).values([
    {
      nameEn: "Standard Employee Onboarding",
      nameAr: "تأهيل الموظف القياسي",
      descriptionEn: "Comprehensive 30-day onboarding programme for all new full-time employees covering documentation, IT setup, equipment issuance, orientation and compliance training.",
      targetEmploymentType: "full_time",
      organizationType: "commercial",
      totalTasks: 8,
      estimatedDays: 30,
      isDefault: true,
      isActive: true,
    },
  ]).returning();

  // ─── ONBOARDING TEMPLATE ITEMS ────────────────────────────────────────────
  console.log("  → onboarding_template_items");
  const templateItems = await db.insert(onboardingTemplateItemsTable).values([
    {
      templateId: template1.id,
      titleEn: "Submit National ID copy",
      titleAr: "تقديم نسخة من الهوية الوطنية",
      ownerRole: "hr",
      taskType: "document",
      dueDayOffset: 1,
      isRequired: true,
      sortOrder: 1,
    },
    {
      templateId: template1.id,
      titleEn: "Complete personal data form",
      titleAr: "استكمال نموذج البيانات الشخصية",
      ownerRole: "employee",
      taskType: "document",
      dueDayOffset: 1,
      isRequired: true,
      sortOrder: 2,
    },
    {
      templateId: template1.id,
      titleEn: "IT account setup",
      titleAr: "إعداد حساب تقنية المعلومات",
      ownerRole: "it",
      taskType: "system_access",
      dueDayOffset: 2,
      isRequired: true,
      sortOrder: 3,
    },
    {
      templateId: template1.id,
      titleEn: "Issue laptop and access card",
      titleAr: "تسليم الحاسوب المحمول وبطاقة الدخول",
      ownerRole: "it",
      taskType: "equipment",
      dueDayOffset: 2,
      isRequired: true,
      sortOrder: 4,
    },
    {
      templateId: template1.id,
      titleEn: "ID card issuance",
      titleAr: "إصدار بطاقة الهوية",
      ownerRole: "admin",
      taskType: "id_card",
      dueDayOffset: 3,
      isRequired: true,
      sortOrder: 5,
    },
    {
      templateId: template1.id,
      titleEn: "HR orientation meeting",
      titleAr: "اجتماع التوجيه مع الموارد البشرية",
      ownerRole: "hr",
      taskType: "meeting",
      dueDayOffset: 3,
      isRequired: true,
      sortOrder: 6,
    },
    {
      templateId: template1.id,
      titleEn: "Manager introduction meeting",
      titleAr: "اجتماع التعريف مع المدير",
      ownerRole: "manager",
      taskType: "meeting",
      dueDayOffset: 5,
      isRequired: true,
      sortOrder: 7,
    },
    {
      templateId: template1.id,
      titleEn: "Complete compliance training",
      titleAr: "إتمام دورة الامتثال",
      ownerRole: "employee",
      taskType: "training",
      dueDayOffset: 14,
      isRequired: true,
      sortOrder: 8,
    },
  ]).returning();

  // ─── EMPLOYEE ONBOARDING RECORDS ──────────────────────────────────────────
  console.log("  → employee_onboarding");
  const [ob1, ob2] = await db.insert(employeeOnboardingTable).values([
    {
      employeeId: 9,
      templateId: template1.id,
      startDate: "2023-05-01",
      targetCompletionDate: "2023-05-31",
      status: "in_progress",
      completionPct: 62,
      managerEmployeeId: 2,
    },
    {
      employeeId: 10,
      templateId: template1.id,
      startDate: "2023-08-01",
      targetCompletionDate: "2023-08-31",
      status: "in_progress",
      completionPct: 37,
      managerEmployeeId: 5,
    },
  ]).returning();

  // ─── ONBOARDING TASKS ────────────────────────────────────────────────────
  console.log("  → onboarding_tasks");
  // Generate 8 tasks for each onboarding record from template items
  // Record 1 (emp9): tasks 1-5 completed, 6-8 pending
  // Record 2 (emp10): tasks 1-3 completed, 4-8 pending
  const ob1Tasks = templateItems.map((item: typeof templateItems[0], idx: number) => ({
    onboardingId: ob1.id,
    templateItemId: item.id,
    titleEn: item.titleEn,
    titleAr: item.titleAr,
    ownerRole: item.ownerRole,
    taskType: item.taskType,
    dueDate: (() => {
      const d = new Date("2023-05-01");
      d.setDate(d.getDate() + item.dueDayOffset);
      return d.toISOString().slice(0, 10);
    })(),
    status: idx < 5 ? "completed" : "pending",
    completedAt: idx < 5 ? new Date("2023-05-0" + (idx + 2)) : null,
    isRequired: item.isRequired,
    sortOrder: item.sortOrder,
  }));

  const ob2Tasks = templateItems.map((item: typeof templateItems[0], idx: number) => ({
    onboardingId: ob2.id,
    templateItemId: item.id,
    titleEn: item.titleEn,
    titleAr: item.titleAr,
    ownerRole: item.ownerRole,
    taskType: item.taskType,
    dueDate: (() => {
      const d = new Date("2023-08-01");
      d.setDate(d.getDate() + item.dueDayOffset);
      return d.toISOString().slice(0, 10);
    })(),
    status: idx < 3 ? "completed" : "pending",
    completedAt: idx < 3 ? new Date("2023-08-0" + (idx + 2)) : null,
    isRequired: item.isRequired,
    sortOrder: item.sortOrder,
  }));

  await db.insert(onboardingTasksTable).values([...ob1Tasks, ...ob2Tasks]);

  // ─── PROBATION RECORDS ────────────────────────────────────────────────────
  console.log("  → probation_records");
  await db.insert(probationRecordsTable).values([
    {
      employeeId: 9,
      startDate: "2023-05-01",
      endDate: "2023-08-01",
      status: "passed",
      midReviewDate: "2023-06-15",
      midReviewScore: 4,
      midReviewNotes: "Employee demonstrates strong initiative and adaptability.",
      midReviewByEmployeeId: 2,
      finalReviewScore: 4,
      finalReviewNotes: "Probation period completed successfully. Confirmed permanent status.",
      finalReviewByEmployeeId: 2,
      outcome: "pass",
      outcomeDate: "2023-08-01",
      confirmationLetterSent: true,
      confirmationLetterSentAt: new Date("2023-08-05"),
    },
    {
      employeeId: 10,
      startDate: "2023-08-01",
      endDate: "2023-11-01",
      status: "active",
      midReviewDate: "2023-09-15",
      midReviewScore: 3,
      midReviewNotes: "Satisfactory progress. Some areas for improvement noted in tactical planning skills.",
      midReviewByEmployeeId: 5,
    },
  ]);

  // ─── EQUIPMENT ISSUANCES ──────────────────────────────────────────────────
  console.log("  → equipment_issuances");
  await db.insert(equipmentIssuancesTable).values([
    {
      employeeId: 1,
      itemType: "laptop",
      itemDescription: "Dell Latitude 5540 — Core i7, 16GB RAM, 512GB SSD",
      serialNumber: "LAP-001-2022",
      assetTag: "IT-LAP-001",
      issuedByUserId: 1,
      status: "issued",
      condition: "good",
      employeeSignature: true,
    },
    {
      employeeId: 2,
      itemType: "phone",
      itemDescription: "iPhone 14 Pro — 256GB",
      serialNumber: "MOB-002-2022",
      assetTag: "IT-MOB-002",
      issuedByUserId: 1,
      status: "issued",
      condition: "good",
      employeeSignature: true,
    },
    {
      employeeId: 5,
      itemType: "vehicle",
      itemDescription: "Toyota Land Cruiser 200 — Official Vehicle",
      assetTag: "VEH-005",
      issuedByUserId: 1,
      status: "issued",
      condition: "good",
      employeeSignature: true,
      notes: "Assigned for field operations and site visits.",
    },
    {
      employeeId: 9,
      onboardingId: ob1.id,
      itemType: "laptop",
      itemDescription: "Dell Latitude 5440 — Core i5, 8GB RAM, 256GB SSD",
      serialNumber: "LAP-009-2023",
      assetTag: "IT-LAP-009",
      issuedByUserId: 1,
      status: "returned",
      condition: "good",
      employeeSignature: true,
      returnedAt: new Date("2023-11-15"),
      returnedByEmployeeId: 9,
      notes: "Returned for hardware upgrade.",
    },
    {
      employeeId: 9,
      onboardingId: ob1.id,
      itemType: "access_card",
      itemDescription: "Building Access Card — Riyadh HQ",
      serialNumber: "ACS-009-2023",
      assetTag: "SEC-ACS-009",
      issuedByUserId: 1,
      status: "issued",
      condition: "good",
      employeeSignature: true,
    },
    {
      employeeId: 10,
      onboardingId: ob2.id,
      itemType: "laptop",
      itemDescription: "HP EliteBook 840 G10 — Core i5, 8GB RAM, 512GB SSD",
      serialNumber: "LAP-010-2023",
      assetTag: "IT-LAP-010",
      issuedByUserId: 1,
      status: "issued",
      condition: "new",
      employeeSignature: true,
    },
  ]);

  // ─── ID CARD RECORDS ──────────────────────────────────────────────────────
  console.log("  → id_card_records");
  await db.insert(idCardRecordsTable).values([
    {
      employeeId: 1,
      cardNumber: "EMP-ID-000001",
      cardType: "employee",
      issuedAt: new Date("2022-01-15"),
      expiryDate: "2027-01-15",
      status: "active",
      issuedByUserId: 1,
    },
    {
      employeeId: 2,
      cardNumber: "EMP-ID-000002",
      cardType: "employee",
      issuedAt: new Date("2022-03-01"),
      expiryDate: "2027-03-01",
      status: "active",
      issuedByUserId: 1,
    },
    {
      employeeId: 3,
      cardNumber: "MIL-ID-000003",
      cardType: "military",
      issuedAt: new Date("2021-07-01"),
      expiryDate: "2026-07-01",
      status: "active",
      issuedByUserId: 1,
    },
    {
      employeeId: 4,
      cardNumber: "MIL-ID-000004",
      cardType: "military",
      issuedAt: new Date("2021-09-15"),
      expiryDate: "2026-09-15",
      status: "active",
      issuedByUserId: 1,
    },
    {
      employeeId: 5,
      cardNumber: "MIL-ID-000005",
      cardType: "military",
      issuedAt: new Date("2023-01-10"),
      expiryDate: "2028-01-10",
      status: "active",
      issuedByUserId: 1,
    },
  ]);

  // ─── COMPETENCY FRAMEWORKS ────────────────────────────────────────────────
  console.log("  → competency_frameworks");
  const [framework1] = await db.insert(competencyFrameworksTable).values([
    {
      nameEn: "Core Leadership Framework",
      nameAr: "إطار الكفاءات القيادية",
      descriptionEn: "Organisation-wide core competency framework defining the key behaviours and capabilities expected of all leadership positions.",
      frameworkType: "leadership",
      applicableTo: "all",
      organizationType: "commercial",
      isActive: true,
      version: "2.0",
    },
  ]).returning();

  // ─── COMPETENCIES ─────────────────────────────────────────────────────────
  console.log("  → competencies");
  const competencies = await db.insert(competenciesTable).values([
    {
      frameworkId: framework1.id,
      codeEn: "STRAT",
      nameEn: "Strategic Thinking",
      nameAr: "التفكير الاستراتيجي",
      descriptionEn: "Ability to understand the big picture, anticipate future trends, and align actions with long-term organisational goals.",
      weight: 25,
      sortOrder: 1,
    },
    {
      frameworkId: framework1.id,
      codeEn: "TEAM_LDR",
      nameEn: "Team Leadership",
      nameAr: "قيادة الفريق",
      descriptionEn: "Ability to inspire, motivate, and develop a high-performing team while fostering an inclusive and collaborative work environment.",
      weight: 25,
      sortOrder: 2,
    },
    {
      frameworkId: framework1.id,
      codeEn: "COMM",
      nameEn: "Communication",
      nameAr: "التواصل",
      descriptionEn: "Ability to convey information clearly and concisely in written and verbal form, and to actively listen and engage with others.",
      weight: 20,
      sortOrder: 3,
    },
    {
      frameworkId: framework1.id,
      codeEn: "PROB_SOLV",
      nameEn: "Problem Solving",
      nameAr: "حل المشكلات",
      descriptionEn: "Ability to analyse complex situations, identify root causes, and develop practical solutions in a timely manner.",
      weight: 15,
      sortOrder: 4,
    },
    {
      frameworkId: framework1.id,
      codeEn: "INTEGRITY",
      nameEn: "Integrity & Compliance",
      nameAr: "النزاهة والامتثال",
      descriptionEn: "Demonstrates honesty, ethical behaviour and consistent adherence to applicable laws, regulations and organisational policies.",
      weight: 15,
      sortOrder: 5,
    },
  ]).returning();

  // Map competency codes to IDs
  const compByCode: Record<string, number> = {};
  for (const c of competencies) compByCode[c.codeEn] = c.id;

  // ─── GOAL CYCLES ──────────────────────────────────────────────────────────
  console.log("  → goal_cycles");
  const [goalCycle1] = await db.insert(goalCyclesTable).values([
    {
      nameEn: "Annual Goals 2026",
      nameAr: "الأهداف السنوية 2026",
      cycleType: "annual",
      year: 2026,
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      goalSettingDeadline: "2026-02-28",
      midYearReviewDate: "2026-06-30",
      status: "active",
      isActive: true,
    },
  ]).returning();

  // ─── EMPLOYEE GOALS ───────────────────────────────────────────────────────
  console.log("  → employee_goals");
  await db.insert(employeeGoalsTable).values([
    // Employee 1 — Director of HR
    {
      cycleId: goalCycle1.id,
      employeeId: 1,
      titleEn: "Reduce HR processing time by 20%",
      titleAr: "تقليص وقت معالجة المعاملات بنسبة 20%",
      descriptionEn: "Implement process improvements and automation to reduce average HR transaction processing time from 5 days to 4 days.",
      goalType: "operational",
      weight: 50,
      targetValue: "20%",
      targetUnit: "reduction",
      progressStatus: "in_progress",
      completionPct: 45,
      status: "approved",
      approvedByEmployeeId: 1,
      approvedAt: new Date("2026-02-28"),
      dueDate: "2026-12-31",
    },
    {
      cycleId: goalCycle1.id,
      employeeId: 1,
      titleEn: "Implement new performance management system",
      titleAr: "تطبيق نظام إدارة الأداء الجديد",
      descriptionEn: "Lead the deployment of the digital performance management system across all departments, including training, change management and go-live.",
      goalType: "strategic",
      weight: 50,
      targetValue: "100%",
      targetUnit: "deployment",
      progressStatus: "in_progress",
      completionPct: 60,
      status: "approved",
      approvedByEmployeeId: 1,
      approvedAt: new Date("2026-02-28"),
      dueDate: "2026-12-31",
      linkedOrgObjective: "Digital Transformation Programme 2026",
    },
    // Employee 2 — Deputy HR Director
    {
      cycleId: goalCycle1.id,
      employeeId: 2,
      titleEn: "Process 100% of payroll on time",
      titleAr: "معالجة 100% من الرواتب في الموعد المحدد",
      descriptionEn: "Ensure all payroll runs are completed and disbursed by the 25th of each month with zero error rate.",
      goalType: "operational",
      weight: 50,
      targetValue: "100%",
      targetUnit: "on-time rate",
      progressStatus: "in_progress",
      completionPct: 75,
      status: "approved",
      approvedByEmployeeId: 1,
      approvedAt: new Date("2026-02-28"),
      dueDate: "2026-12-31",
    },
    {
      cycleId: goalCycle1.id,
      employeeId: 2,
      titleEn: "Develop HR team capabilities",
      titleAr: "تطوير قدرات فريق الموارد البشرية",
      descriptionEn: "Design and implement a capability development plan for the HR team, targeting completion of at least 2 development activities per team member by year-end.",
      goalType: "developmental",
      weight: 50,
      targetValue: "2",
      targetUnit: "activities per person",
      progressStatus: "in_progress",
      completionPct: 50,
      status: "approved",
      approvedByEmployeeId: 1,
      approvedAt: new Date("2026-02-28"),
      dueDate: "2026-12-31",
    },
    // Employee 3 — Brigade Commander
    {
      cycleId: goalCycle1.id,
      employeeId: 3,
      titleEn: "Achieve 95% brigade operational readiness",
      titleAr: "تحقيق جاهزية عملياتية للواء بنسبة 95%",
      descriptionEn: "Maintain 1st Brigade at or above 95% operational readiness across all readiness indicators as assessed by the quarterly readiness review.",
      goalType: "operational",
      weight: 60,
      targetValue: "95%",
      targetUnit: "readiness rating",
      progressStatus: "in_progress",
      completionPct: 80,
      status: "approved",
      approvedByEmployeeId: 1,
      approvedAt: new Date("2026-02-28"),
      dueDate: "2026-12-31",
    },
    {
      cycleId: goalCycle1.id,
      employeeId: 3,
      titleEn: "Complete leadership certification programme",
      titleAr: "إتمام برنامج شهادة القيادة",
      descriptionEn: "Successfully complete the Advanced Command and Leadership Certification Programme at the National Defence College.",
      goalType: "developmental",
      weight: 40,
      targetValue: "1",
      targetUnit: "certification",
      progressStatus: "in_progress",
      completionPct: 40,
      status: "approved",
      approvedByEmployeeId: 1,
      approvedAt: new Date("2026-02-28"),
      dueDate: "2026-11-30",
    },
  ]);

  // ─── APPRAISAL CYCLES ─────────────────────────────────────────────────────
  console.log("  → appraisal_cycles");
  const [apprCycle1] = await db.insert(appraisalCyclesTable).values([
    {
      nameEn: "Annual Appraisal 2025",
      nameAr: "التقييم السنوي 2025",
      goalCycleId: null,
      competencyFrameworkId: framework1.id,
      year: 2025,
      appraisalType: "annual",
      selfAppraisalDeadline: "2025-12-15",
      managerAppraisalDeadline: "2026-01-07",
      calibrationDeadline: "2026-01-20",
      status: "calibration",
      goalsWeight: 60,
      competenciesWeight: 40,
      isActive: true,
    },
  ]).returning();

  // ─── APPRAISAL RECORDS ────────────────────────────────────────────────────
  console.log("  → appraisal_records");
  const [appr1, appr2, appr3] = await db.insert(appraisalRecordsTable).values([
    {
      cycleId: apprCycle1.id,
      employeeId: 1,
      reviewerEmployeeId: 1,
      selfGoalsScore: "4.0",
      selfCompetencyScore: "4.2",
      selfOverallScore: "4.1",
      selfStrengths: "Strategic vision and stakeholder management.",
      selfDevelopmentAreas: "Digital HR skills.",
      selfSubmittedAt: new Date("2025-12-12"),
      managerGoalsScore: "3.8",
      managerCompetencyScore: "4.0",
      managerOverallScore: "3.9",
      managerComments: "Strong performance across most areas. Recommend continued investment in digital capabilities.",
      managerSubmittedAt: new Date("2026-01-05"),
      calibratedScore: "3.9",
      calibrationNotes: "Agreed at calibration. Score confirmed.",
      calibratedAt: new Date("2026-01-15"),
      calibratedByUserId: 1,
      finalRating: "B+",
      status: "calibrated",
      promotionRecommended: false,
    },
    {
      cycleId: apprCycle1.id,
      employeeId: 2,
      reviewerEmployeeId: 1,
      selfGoalsScore: "4.5",
      selfCompetencyScore: "4.3",
      selfOverallScore: "4.4",
      selfStrengths: "Financial accuracy, team coordination, people development.",
      selfSubmittedAt: new Date("2025-12-10"),
      managerGoalsScore: "4.3",
      managerCompetencyScore: "4.2",
      managerOverallScore: "4.3",
      managerComments: "Exceptional financial management and HR operations leadership.",
      managerSubmittedAt: new Date("2026-01-04"),
      calibratedScore: "4.3",
      calibrationNotes: "Confirmed A grade. Promotion to G9 recommended.",
      calibratedAt: new Date("2026-01-15"),
      calibratedByUserId: 1,
      finalRating: "A",
      status: "calibrated",
      promotionRecommended: true,
    },
    {
      cycleId: apprCycle1.id,
      employeeId: 3,
      reviewerEmployeeId: 1,
      selfGoalsScore: "4.8",
      selfCompetencyScore: "4.7",
      selfOverallScore: "4.7",
      selfStrengths: "Outstanding strategic command, tactical excellence, troop morale.",
      selfSubmittedAt: new Date("2025-12-08"),
      managerGoalsScore: "4.6",
      managerCompetencyScore: "4.5",
      managerOverallScore: "4.6",
      managerComments: "Highest performing brigade commander in this cohort. Recommend for promotion.",
      managerSubmittedAt: new Date("2026-01-03"),
      calibratedScore: "4.6",
      calibrationNotes: "Unanimous A grade confirmed. Promoted to Major General recommended.",
      calibratedAt: new Date("2026-01-15"),
      calibratedByUserId: 1,
      finalRating: "A",
      status: "shared",
      sharedWithEmployeeAt: new Date("2026-01-20"),
      promotionRecommended: true,
    },
  ]).returning();

  // ─── APPRAISAL COMPETENCY RATINGS ─────────────────────────────────────────
  console.log("  → appraisal_competency_ratings");
  await db.insert(appraisalCompetencyRatingsTable).values([
    // Employee 1
    { appraisalId: appr1.id, competencyId: compByCode["STRAT"], raterType: "manager", score: 4 },
    { appraisalId: appr1.id, competencyId: compByCode["TEAM_LDR"], raterType: "manager", score: 4 },
    // Employee 2
    { appraisalId: appr2.id, competencyId: compByCode["STRAT"], raterType: "manager", score: 5 },
    { appraisalId: appr2.id, competencyId: compByCode["COMM"], raterType: "manager", score: 4 },
    // Employee 3
    { appraisalId: appr3.id, competencyId: compByCode["STRAT"], raterType: "manager", score: 5 },
    { appraisalId: appr3.id, competencyId: compByCode["TEAM_LDR"], raterType: "manager", score: 5 },
  ]);

  // ─── CALIBRATION SESSIONS ─────────────────────────────────────────────────
  console.log("  → calibration_sessions");
  await db.insert(calibrationSessionsTable).values([
    {
      cycleId: apprCycle1.id,
      departmentId: 1,
      sessionDate: new Date("2026-01-15T10:00:00"),
      status: "completed",
      facilitatorUserId: 1,
      attendeesJson: JSON.stringify([1, 2, 3]),
      notes: "All records in the HR Directorate calibrated. Scores confirmed and final ratings assigned.",
    },
  ]);

  // ─── DISCIPLINARY RECORDS ─────────────────────────────────────────────────
  console.log("  → disciplinary_records");
  await db.insert(disciplinaryRecordsTable).values([
    {
      employeeId: 8,
      actionType: "written_warning",
      category: "attendance",
      incidentDate: "2025-11-10",
      actionDate: "2025-11-15",
      descriptionEn: "Repeated tardiness — arrived late 8 times in November 2025 without prior notice. Employee was counselled verbally on two prior occasions with no improvement noted.",
      descriptionAr: "تأخر متكرر — وصل متأخراً 8 مرات في نوفمبر 2025 دون إشعار مسبق.",
      status: "active",
      issuedByEmployeeId: 4,
      hrApprovedByUserId: 1,
      employeeAcknowledged: true,
      employeeAcknowledgedAt: new Date("2025-11-17"),
      requiresDualAuth: false,
    },
  ]);

  // ─── COMMENDATION RECORDS ─────────────────────────────────────────────────
  console.log("  → commendation_records");
  await db.insert(commendationRecordsTable).values([
    {
      employeeId: 3,
      awardType: "certificate",
      titleEn: "Excellence in Brigade Command 2025",
      titleAr: "التميز في قيادة اللواء 2025",
      descriptionEn: "Awarded in recognition of outstanding operational leadership during the annual readiness exercise, achieving the highest brigade performance score in the history of the 1st Brigade.",
      awardDate: "2025-12-20",
      nominatedByEmployeeId: 1,
      approvedByEmployeeId: 1,
      approvedAt: new Date("2025-12-18"),
      promotionPoints: 10,
      isPublic: true,
    },
    {
      employeeId: 2,
      awardType: "letter_of_appreciation",
      titleEn: "Outstanding Financial Accuracy Award",
      titleAr: "جائزة الدقة المالية المتميزة",
      descriptionEn: "Awarded for achieving zero payroll error rate across all 12 monthly payroll cycles in 2025, representing a significant improvement in financial compliance.",
      awardDate: "2025-12-15",
      nominatedByEmployeeId: 1,
      approvedByEmployeeId: 1,
      approvedAt: new Date("2025-12-13"),
      promotionPoints: 5,
      isPublic: true,
    },
  ]);

  // ─── PROMOTION RECOMMENDATIONS ────────────────────────────────────────────
  console.log("  → promotion_recommendations");
  await db.insert(promotionRecommendationsTable).values([
    {
      employeeId: 2,
      appraisalId: appr2.id,
      currentGradeCode: "G8",
      recommendedGradeCode: "G9",
      recommendationDate: "2026-01-15",
      justificationEn: "Consistent A-grade performance, zero error payroll record, and demonstrated leadership in team development initiatives make this candidate an ideal candidate for promotion to Grade 9.",
      status: "approved",
      reviewedByEmployeeId: 1,
      reviewedAt: new Date("2026-01-20"),
      effectiveDate: "2026-01-01",
      requiresDualAuth: false,
    },
    {
      employeeId: 3,
      appraisalId: appr3.id,
      currentRankCode: "BGEN",
      recommendedRankCode: "MGEN",
      recommendationDate: "2026-01-15",
      justificationEn: "Exceptional performance — highest calibrated score in cohort. 1st Brigade achieved 97% operational readiness under his command. Promotion to Major General is strongly recommended.",
      status: "pending",
      requiresDualAuth: true,
    },
  ]);

  // ─── TRAINING PROGRAMS ────────────────────────────────────────────────────
  console.log("  → training_programs");
  const [prog1, prog2] = await db.insert(trainingProgramsTable).values([
    {
      codeEn: "LDP-2026",
      nameEn: "Leadership Development Program",
      nameAr: "برنامج تطوير القيادة",
      descriptionEn: "A comprehensive programme designed to build and enhance leadership competencies across all management levels.",
      category: "leadership",
      organizationType: "commercial",
      isActive: true,
    },
    {
      codeEn: "MIL-TRG-2026",
      nameEn: "Military Skills & Tactical Training",
      nameAr: "التدريب المهاري والتكتيكي",
      descriptionEn: "Advanced military skills and tactical operations training programme for commissioned and non-commissioned officers.",
      category: "military",
      organizationType: "military",
      isActive: true,
    },
  ]).returning();

  // ─── TRAINING COURSES ─────────────────────────────────────────────────────
  console.log("  → training_courses");
  const [course1, course2, course3] = await db.insert(trainingCoursesTable).values([
    {
      programId: prog1.id,
      codeEn: "LDP-EL-001",
      nameEn: "Effective Leadership",
      nameAr: "القيادة الفعالة",
      descriptionEn: "Foundational leadership course covering situational leadership, team motivation, communication and decision-making frameworks.",
      deliveryMode: "classroom",
      durationHours: 16,
      maxParticipants: 20,
      providerType: "internal",
      providerName: "National Training Institute",
      costPerPerson: "0",
      grantsCertification: true,
      certificationValidMonths: 24,
      isActive: true,
    },
    {
      programId: prog1.id,
      codeEn: "LDP-SC-002",
      nameEn: "Strategic Communication",
      nameAr: "التواصل الاستراتيجي",
      descriptionEn: "Advanced communication course focusing on executive presentations, stakeholder management and crisis communication.",
      deliveryMode: "blended",
      durationHours: 8,
      maxParticipants: 15,
      providerType: "internal",
      costPerPerson: "0",
      grantsCertification: false,
      isActive: true,
    },
    {
      programId: prog2.id,
      codeEn: "MIL-ATO-003",
      nameEn: "Advanced Tactical Operations",
      nameAr: "العمليات التكتيكية المتقدمة",
      descriptionEn: "High-fidelity simulation-based training covering advanced tactical manoeuvre, command and control under pressure, and multi-domain operations.",
      deliveryMode: "simulation",
      durationHours: 40,
      maxParticipants: 12,
      providerType: "internal",
      costPerPerson: "0",
      grantsCertification: true,
      certificationValidMonths: 36,
      isActive: true,
    },
  ]).returning();

  // ─── TRAINING SESSIONS ────────────────────────────────────────────────────
  console.log("  → training_sessions");
  const [session1, session2] = await db.insert(trainingSessionsTable).values([
    {
      courseId: course1.id,
      sessionCode: "LDR-2026-01",
      startDate: "2026-03-10",
      endDate: "2026-03-11",
      startTime: "08:00",
      endTime: "17:00",
      location: "Training Room A, Riyadh HQ",
      trainerName: "Dr. Walid Al-Mansouri",
      status: "completed",
      maxParticipants: 20,
      enrolledCount: 12,
      attendedCount: 10,
      passingScore: 70,
      notes: "Session completed successfully. Attendance certificate issued to passing participants.",
    },
    {
      courseId: course2.id,
      sessionCode: "COM-2026-01",
      startDate: "2026-09-15",
      endDate: "2026-09-16",
      startTime: "08:00",
      endTime: "17:00",
      location: "Blended — Teams + Riyadh HQ",
      trainerName: "Eng. Sara Al-Otaibi",
      status: "scheduled",
      maxParticipants: 15,
      enrolledCount: 8,
      attendedCount: 0,
    },
  ]).returning();

  // ─── COURSE NOMINATIONS ───────────────────────────────────────────────────
  console.log("  → course_nominations");
  const nominations = await db.insert(courseNominationsTable).values([
    {
      sessionId: session1.id,
      employeeId: 1,
      nominationSource: "mandatory",
      nominatedByEmployeeId: 1,
      status: "enrolled",
      isMandatory: true,
      approvedByUserId: 1,
      approvedAt: new Date("2026-02-20"),
    },
    {
      sessionId: session1.id,
      employeeId: 2,
      nominationSource: "mandatory",
      nominatedByEmployeeId: 1,
      status: "enrolled",
      isMandatory: true,
      approvedByUserId: 1,
      approvedAt: new Date("2026-02-20"),
    },
    {
      sessionId: session1.id,
      employeeId: 3,
      nominationSource: "mandatory",
      nominatedByEmployeeId: 1,
      status: "enrolled",
      isMandatory: true,
      approvedByUserId: 1,
      approvedAt: new Date("2026-02-20"),
    },
    {
      sessionId: session2.id,
      employeeId: 4,
      nominationSource: "manager",
      nominatedByEmployeeId: 3,
      status: "approved",
      isMandatory: false,
      approvedByUserId: 1,
      approvedAt: new Date("2026-08-01"),
    },
    {
      sessionId: session2.id,
      employeeId: 5,
      nominationSource: "manager",
      nominatedByEmployeeId: 3,
      status: "approved",
      isMandatory: false,
      approvedByUserId: 1,
      approvedAt: new Date("2026-08-01"),
    },
  ]).returning();

  // ─── TRAINING ATTENDANCE ──────────────────────────────────────────────────
  console.log("  → training_attendance");
  await db.insert(trainingAttendanceTable).values([
    {
      sessionId: session1.id,
      employeeId: 1,
      nominationId: nominations[0].id,
      attendanceStatus: "present",
      attendancePct: 100,
      assessmentScore: 88,
      passed: true,
      completedAt: new Date("2026-03-11T17:00:00"),
      certificateIssued: true,
      certificateIssuedAt: new Date("2026-03-11"),
    },
    {
      sessionId: session1.id,
      employeeId: 2,
      nominationId: nominations[1].id,
      attendanceStatus: "present",
      attendancePct: 100,
      assessmentScore: 95,
      passed: true,
      completedAt: new Date("2026-03-11T17:00:00"),
      certificateIssued: true,
      certificateIssuedAt: new Date("2026-03-11"),
    },
    {
      sessionId: session1.id,
      employeeId: 3,
      nominationId: nominations[2].id,
      attendanceStatus: "present",
      attendancePct: 100,
      assessmentScore: 91,
      passed: true,
      completedAt: new Date("2026-03-11T17:00:00"),
      certificateIssued: true,
      certificateIssuedAt: new Date("2026-03-11"),
    },
    {
      sessionId: session1.id,
      employeeId: 4,
      attendanceStatus: "partial",
      attendancePct: 75,
      assessmentScore: 70,
      passed: true,
      completedAt: new Date("2026-03-11T17:00:00"),
      certificateIssued: false,
      notes: "Employee left early on day 1 due to operational commitment.",
    },
    {
      sessionId: session1.id,
      employeeId: 5,
      attendanceStatus: "absent",
      attendancePct: 0,
      passed: false,
      certificateIssued: false,
      notes: "Employee was deployed on operational duties and unable to attend.",
    },
  ]);

  // ─── CERTIFICATIONS ───────────────────────────────────────────────────────
  console.log("  → certifications");
  await db.insert(certificationsTable).values([
    {
      employeeId: 1,
      courseId: course1.id,
      sessionId: session1.id,
      certificationName: "Effective Leadership Certificate",
      issuingBody: "National Training Institute",
      certificationNumber: "NTI-EL-2026-001",
      issuedDate: "2026-03-11",
      expiryDate: "2028-03-11",
      status: "active",
      certType: "internal",
    },
    {
      employeeId: 2,
      courseId: course1.id,
      sessionId: session1.id,
      certificationName: "Effective Leadership Certificate",
      issuingBody: "National Training Institute",
      certificationNumber: "NTI-EL-2026-002",
      issuedDate: "2026-03-11",
      expiryDate: "2028-03-11",
      status: "active",
      certType: "internal",
    },
    {
      employeeId: 2,
      certificationName: "Project Management Professional",
      issuingBody: "PMI",
      certificationNumber: "PMP-2024-SA-0418",
      issuedDate: "2024-06-01",
      expiryDate: "2027-06-01",
      status: "active",
      certType: "external",
      verificationUrl: "https://www.pmi.org/certifications/verify",
    },
    {
      employeeId: 3,
      courseId: course3.id,
      certificationName: "Advanced Tactical Operations Certificate",
      issuingBody: "Royal Armed Forces Training Command",
      certificationNumber: "RAF-ATO-2025-003",
      issuedDate: "2025-01-15",
      expiryDate: "2028-01-15",
      status: "active",
      certType: "military",
    },
    {
      employeeId: 7,
      certificationName: "ISO 27001 Lead Auditor",
      issuingBody: "BSI Group",
      certificationNumber: "BSI-LA27001-2023-7892",
      issuedDate: "2023-09-01",
      expiryDate: "2026-09-01",
      status: "active",
      certType: "external",
      verificationUrl: "https://www.bsigroup.com/verify",
    },
    {
      employeeId: 9,
      certificationName: "Supply Chain Management Certificate",
      issuingBody: "Saudi Logistics Academy",
      certificationNumber: "SLA-SCM-2024-009",
      issuedDate: "2024-02-20",
      expiryDate: "2027-02-20",
      status: "active",
      certType: "external",
    },
  ]);

  // ─── EMPLOYEE SKILLS ──────────────────────────────────────────────────────
  console.log("  → employee_skills");
  await db.insert(employeeSkillsTable).values([
    // Employee 1
    { employeeId: 1, skillName: "HR Management", skillCategory: "technical", proficiencyLevel: 5, assessmentMethod: "certified" },
    { employeeId: 1, skillName: "Arabic", skillCategory: "language", proficiencyLevel: 5, assessmentMethod: "self_assessed" },
    { employeeId: 1, skillName: "English", skillCategory: "language", proficiencyLevel: 4, assessmentMethod: "test_verified" },
    // Employee 2
    { employeeId: 2, skillName: "Financial Reporting", skillCategory: "technical", proficiencyLevel: 4, assessmentMethod: "manager_assessed" },
    { employeeId: 2, skillName: "SAP HCM", skillCategory: "technical", proficiencyLevel: 3, assessmentMethod: "self_assessed" },
    // Employee 3
    { employeeId: 3, skillName: "Military Strategy", skillCategory: "military", proficiencyLevel: 5, assessmentMethod: "certified" },
    { employeeId: 3, skillName: "Leadership", skillCategory: "soft", proficiencyLevel: 5, assessmentMethod: "manager_assessed" },
    // Employee 7
    { employeeId: 7, skillName: "Intelligence Analysis", skillCategory: "technical", proficiencyLevel: 5, assessmentMethod: "certified" },
    { employeeId: 7, skillName: "Cybersecurity", skillCategory: "technical", proficiencyLevel: 4, assessmentMethod: "certified" },
    // Employee 9
    { employeeId: 9, skillName: "Supply Chain", skillCategory: "technical", proficiencyLevel: 3, assessmentMethod: "certified" },
    { employeeId: 9, skillName: "ERP Systems", skillCategory: "technical", proficiencyLevel: 2, assessmentMethod: "self_assessed" },
  ]);

  // ─── SUCCESSION POOLS ─────────────────────────────────────────────────────
  console.log("  → succession_pools");
  const [pool1, pool2] = await db.insert(successionPoolsTable).values([
    {
      nameEn: "Senior HR Leadership",
      nameAr: "القيادة العليا للموارد البشرية",
      descriptionEn: "Succession pool for the Director of Human Resources and senior HR leadership roles.",
      targetJobTitleEn: "Director of Human Resources",
      targetGradeCode: "G11",
      poolType: "critical_role",
      organizationType: "commercial",
      ownedByEmployeeId: 1,
      isActive: true,
    },
    {
      nameEn: "Command Cadre",
      nameAr: "كادر القيادة",
      descriptionEn: "Strategic succession pool for Brigade Commander and senior operational command positions.",
      targetJobTitleEn: "Brigade Commander",
      targetRankCode: "BGEN",
      poolType: "leadership",
      organizationType: "military",
      ownedByEmployeeId: 1,
      isActive: true,
    },
  ]).returning();

  // ─── SUCCESSION CANDIDATES ────────────────────────────────────────────────
  console.log("  → succession_candidates");
  const [cand1, , cand3] = await db.insert(successionCandidatesTable).values([
    {
      poolId: pool1.id,
      employeeId: 2,
      readinessLevel: "ready_1_year",
      talentScore: 5,
      performanceRating: "A",
      flightRisk: "low",
      impactIfLost: "high",
      futureIntent: "grow",
      addedByUserId: 1,
      reviewNotes: "Top performer with demonstrated readiness for Director role. Pending promotion to G9 will further qualify.",
      isActive: true,
    },
    {
      poolId: pool2.id,
      employeeId: 4,
      readinessLevel: "ready_2_years",
      talentScore: 4,
      performanceRating: "B+",
      flightRisk: "low",
      impactIfLost: "high",
      futureIntent: "grow",
      addedByUserId: 1,
      reviewNotes: "Strong operational leader. Completing Staff College will accelerate readiness.",
      isActive: true,
    },
    {
      poolId: pool2.id,
      employeeId: 5,
      readinessLevel: "ready_1_year",
      talentScore: 4,
      performanceRating: "B+",
      flightRisk: "medium",
      impactIfLost: "high",
      futureIntent: "grow",
      addedByUserId: 1,
      reviewNotes: "Proven battalion commander with excellent tactical skills. Flight risk flagged for mentoring intervention.",
      isActive: true,
    },
  ]).returning();

  // ─── DEVELOPMENT PLANS ────────────────────────────────────────────────────
  console.log("  → development_plans");
  const [plan1, plan2] = await db.insert(developmentPlansTable).values([
    {
      employeeId: 2,
      successionCandidateId: cand1.id,
      nameEn: "HR Director Readiness Plan 2026",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      targetCompetencies: String(compByCode["STRAT"]) + "," + String(compByCode["TEAM_LDR"]),
      status: "active",
      approvedByEmployeeId: 1,
      approvedAt: new Date("2026-01-10"),
      completionPct: 35,
    },
    {
      employeeId: 5,
      successionCandidateId: cand3.id,
      nameEn: "Brigade Command Preparation",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      targetCompetencies: String(compByCode["STRAT"]) + "," + String(compByCode["TEAM_LDR"]) + "," + String(compByCode["INTEGRITY"]),
      status: "active",
      approvedByEmployeeId: 3,
      approvedAt: new Date("2026-01-12"),
      completionPct: 20,
    },
  ]).returning();

  // ─── DEVELOPMENT ACTIVITIES ───────────────────────────────────────────────
  console.log("  → development_activities");
  await db.insert(developmentActivitiesTable).values([
    // Plan 1 — HR Director Readiness
    {
      planId: plan1.id,
      titleEn: "Complete MBA Leadership Module",
      activityType: "training",
      targetCompetencyId: compByCode["STRAT"],
      dueDate: "2026-06-30",
      status: "in_progress",
      sortOrder: 1,
    },
    {
      planId: plan1.id,
      titleEn: "Shadow Director for 3 months",
      activityType: "shadowing",
      targetCompetencyId: compByCode["TEAM_LDR"],
      dueDate: "2026-04-30",
      status: "completed",
      completedAt: new Date("2026-04-28"),
      completionNotes: "Successfully completed 3-month shadowing assignment with the Director of HR.",
      sortOrder: 2,
    },
    {
      planId: plan1.id,
      titleEn: "Lead HR Digital Transformation project",
      activityType: "stretch_assignment",
      targetCompetencyId: compByCode["STRAT"],
      dueDate: "2026-12-31",
      status: "in_progress",
      sortOrder: 3,
    },
    // Plan 2 — Brigade Command Preparation
    {
      planId: plan2.id,
      titleEn: "Advanced Tactical Command course",
      activityType: "training",
      courseId: course3.id,
      targetCompetencyId: compByCode["STRAT"],
      dueDate: "2026-09-30",
      status: "pending",
      sortOrder: 1,
    },
    {
      planId: plan2.id,
      titleEn: "Staff College attendance",
      activityType: "training",
      targetCompetencyId: compByCode["TEAM_LDR"],
      dueDate: "2026-12-31",
      status: "pending",
      sortOrder: 2,
    },
  ]);

  // ─── EMPLOYEE REQUESTS ────────────────────────────────────────────────────
  console.log("  → employee_requests");
  await db.insert(employeeRequestsTable).values([
    {
      requestNumber: "REQ-SS-2026-001",
      employeeId: 6,
      requestType: "employment_letter",
      titleEn: "Employment Verification Letter for Bank",
      descriptionEn: "Requesting an official employment verification letter for use at Al-Rajhi Bank to support a personal loan application.",
      addressedTo: "Al-Rajhi Bank",
      purposeEn: "Personal loan application",
      status: "fulfilled",
      urgency: "urgent",
      reviewedByUserId: 1,
      reviewedAt: new Date("2026-06-28"),
      fulfilledAt: new Date("2026-07-01"),
    },
    {
      requestNumber: "REQ-SS-2026-002",
      employeeId: 9,
      requestType: "salary_certificate",
      titleEn: "Salary Certificate for Housing Application",
      descriptionEn: "Requesting an official salary certificate for submission to the Real Estate Development Fund (REDF) as part of a housing loan application.",
      addressedTo: "Real Estate Development Fund",
      purposeEn: "Housing loan application",
      status: "in_review",
      urgency: "normal",
      reviewedByUserId: 1,
      reviewedAt: new Date("2026-07-05"),
    },
    {
      requestNumber: "REQ-SS-2026-003",
      employeeId: 10,
      requestType: "experience_letter",
      titleEn: "Experience Letter for University Application",
      descriptionEn: "Requesting an experience letter confirming service details for university admission requirements.",
      purposeEn: "University admission application",
      status: "pending",
      urgency: "low",
    },
  ]);

  // ─── ANNOUNCEMENTS ────────────────────────────────────────────────────────
  console.log("  → announcements");
  await db.insert(announcementsTable).values([
    {
      titleEn: "Annual Performance Review 2025 — Results Available",
      titleAr: "نتائج التقييم السنوي للأداء 2025 متاحة الآن",
      bodyEn: "All employees are advised that the results for the Annual Performance Review 2025 are now available. Please log in to the HRMS portal to view your performance rating and feedback from your line manager.",
      bodyAr: "يُحاط جميع الموظفين علماً بأن نتائج التقييم السنوي للأداء لعام 2025 أصبحت متاحة الآن. يُرجى تسجيل الدخول إلى بوابة نظام الموارد البشرية للاطلاع على تقييمك وملاحظات مديرك المباشر.",
      category: "general",
      targetAudience: "all",
      isPinned: false,
      publishedAt: new Date("2026-01-20"),
      status: "published",
      authorUserId: 1,
      requiresAcknowledgement: false,
    },
    {
      titleEn: "Eid Al-Adha Public Holiday",
      titleAr: "إجازة عيد الأضحى المبارك",
      bodyEn: "In celebration of Eid Al-Adha, official working days will be suspended from Sunday 15 June 2026 through Saturday 21 June 2026 inclusive. Staff are required to ensure all critical tasks are handed over before the holiday period.",
      bodyAr: "بمناسبة عيد الأضحى المبارك، ستُعلَّق أيام العمل الرسمية من يوم الأحد الموافق 15 يونيو 2026 وحتى يوم السبت 21 يونيو 2026 شاملاً. يُرجى من الموظفين التأكد من تسليم المهام الحرجة قبل فترة الإجازة.",
      category: "holiday",
      targetAudience: "all",
      isPinned: false,
      publishedAt: new Date("2026-06-01"),
      status: "published",
      authorUserId: 1,
      requiresAcknowledgement: false,
    },
    {
      titleEn: "New Security Policy Update — Mandatory Reading",
      titleAr: "تحديث سياسة الأمن الجديدة — قراءة إلزامية",
      bodyEn: "A revised Security Policy (SP-2026-03) has been issued and is effective immediately. All staff must read and acknowledge the updated policy. Key changes include updated clean-desk requirements, updated password policy (90-day rotation), and new procedures for handling classified documents. Please review the full policy document attached.",
      bodyAr: "صدرت سياسة الأمن المُحدَّثة (SP-2026-03) ودخلت حيز التنفيذ فوراً. يُلزَم جميع الموظفين بقراءة السياسة الجديدة والإقرار بها. تشمل التغييرات الرئيسية متطلبات المكتب النظيف ومتطلبات كلمة المرور المحدَّثة (تغيير كل 90 يوماً) وإجراءات جديدة للتعامل مع الوثائق المصنَّفة.",
      category: "policy",
      targetAudience: "all",
      isPinned: true,
      publishedAt: new Date("2026-07-01"),
      status: "published",
      authorUserId: 1,
      requiresAcknowledgement: true,
    },
  ]);

  // ─── APPROVAL DELEGATIONS ─────────────────────────────────────────────────
  console.log("  → approval_delegations");
  await db.insert(approvalDelegationsTable).values([
    {
      delegatorEmployeeId: 1,
      delegateEmployeeId: 2,
      startDate: "2026-08-01",
      endDate: "2026-08-15",
      delegationType: "leave_approval",
      reason: "Delegator on annual leave — all leave approvals delegated to Deputy HR Director during this period.",
      status: "active",
      approvedByUserId: 1,
    },
    {
      delegatorEmployeeId: 3,
      delegateEmployeeId: 4,
      startDate: "2026-09-10",
      endDate: "2026-09-20",
      delegationType: "all",
      reason: "Official travel — attending Joint Forces Command Conference. All approval authorities delegated to Brigade Chief of Staff.",
      status: "active",
      approvedByUserId: 1,
    },
  ]);

  console.log("✅ Phase 5 seed complete.");
}

main().catch(console.error);
