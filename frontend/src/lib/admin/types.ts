/** Shapes returned by the Admin API (/api/v1/admin/...). */

export type ReviewStatus = "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "NEEDS_CORRECTION" | "REVIEWED" | "REJECTED";
export type RecordType = "REAL" | "DEMO" | "TEST";
export type EntrySource = "MANUFACTURER" | "ADMIN_ASSISTED" | "IMPORTED";
export type AccountStatus = "active" | "suspended" | "deactivated";

export type AdminMe = {
  id: string;
  name: string | null;
  email: string;
  roles: string[];
  authMethod: "clerk" | "password";
  /** Signed in with a temporary password: must choose a new one first. */
  mustChangePassword?: boolean;
};

export type AdminRole = "platform_administrator" | "platform_operator" | "support_specialist" | "verification_analyst";

/** GET /admin/admin-users (Admins tab). */
export type AdminUser = {
  id: string;
  name: string | null;
  email: string;
  role: AdminRole | "";
  roleLabel: string;
  status: "active" | "revoked" | "suspended";
  hasAdminAccount: boolean;
  hasXyAccount: boolean;
  mustChangePassword: boolean;
  locked: boolean;
  grantedAt: string | null;
  grantedBy: string | null;
  revokedAt: string | null;
  lastSignIn: string | null;
  isDefault: boolean;
  isYou: boolean;
};
export type AdminUserRef = { id: string; name: string | null; email: string };

export type SectionState = { name: string; complete: boolean };

export type ManufacturerRow = {
  id: string;
  companyName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  industry: string | null;
  country: string | null;
  city: string | null;
  location: string | null;
  majorProcess: string | null;
  listingCount: number;
  completeness: number;
  requiredDone: number;
  requiredTotal: number;
  reviewStatus: ReviewStatus;
  recordType: RecordType;
  entrySource: EntrySource;
  /** How the company first came onto X!Y (null = unknown). Separate from the review status. */
  onboardingSource?: OnboardingSource | null;
  /** Why the source is unknown (evidence backfill), when it is. */
  onboardingSourceNote?: string | null;
  /** The first active member (owner first) — a person, kept apart from the company contact. */
  primaryUser?: { id: string; name: string | null; email: string | null } | null;
  /** A new company not approved yet: the channel on its staged submission and that status. */
  stagedSource?: StagedSource | null;
  referralSource: string | null;
  assignedAdminId: string | null;
  assignedAdminName?: string | null;
  isArchived: boolean;
  archivedAt: string | null;
  registeredAt: string;
  lastUpdated: string;
  lastSeenAt: string | null;
  ownerUserId: string | null;
  attentionReason: string | null;
  missingFields: string[];
  sections: SectionState[];
  stoppedAt: string | null;
  lastCompletedSection: string | null;
  /** Users linked to exactly this company by an active membership. */
  linkedUsers?: number;
  /** Review queue: the newest request awaiting a decision on this company. */
  request?: {
    kind: "new_company" | "claim" | "update" | "update_request";
    label: string;
    requestedBy: string | null;
    submittedAt: string | null;
    openCount: number;
  } | null;
};

export type OverviewData = {
  cards: {
    totalUsers: number;
    totalManufacturers: number;
    completed: number;
    incomplete: number;
    awaitingReview: number;
    testDemo: number;
    openSupportIssues: number;
  };
  recentRegistrations: ManufacturerRow[];
  recentlyUpdated: ManufacturerRow[];
  needsAttention: ManufacturerRow[];
};

export type ManufacturerList = {
  total: number;
  page: number;
  pageSize: number;
  rows: ManufacturerRow[];
  facets: { industries: string[]; countries: string[] };
};

export type Certification = { name: string; body: string; fileName: string; status: string };
export type Faq = { q: string; a: string };

export type ProfileData = {
  company: Record<string, string | null>;
  location: Record<string, string | string[] | null> & { serviceableAreas: string[] };
  certifications: Certification[];
  infra: Record<string, string>;
  faqs: Faq[];
};

export type Machine = {
  id: string;
  industry: string;
  subcategory: string;
  type: string;
  capacity: string;
  age: string;
  condition: string;
  technical: string;
  images: { src: string; primary: boolean }[];
  rawMatStatus: string;
  materialDetails: string;
  laborType: string;
  workerCount: string;
  workerRoles: string;
  logistics: string[];
  logisticsPartner: string;
  pricing: Record<string, string>;
  insurance: string;
  status: string;
};

export type ChangeEntry = {
  id: string;
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
  created_at: string;
  changed_by: string | null;
};

export type Note = { id: string; note: string; created_at: string; admin_name: string | null; shared?: boolean };

export type ManufacturerDetail = {
  manufacturer: ManufacturerRow;
  profile: {
    profileData: ProfileData;
    state: {
      account: Record<string, string>;
      contact: { email: string; phone: string };
      machinery: Machine[];
      serviceableAreas: string[];
    };
    profileProgress: { percentage: number; status: string };
    machineryDraft: { id: string; currentStep: number; data: Omit<Machine, "id" | "status"> } | null;
  };
  contacts: { email: string; phone: string };
  linkedUsers: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string;
    phone: string | null;
    status: AccountStatus;
    membership_role: string;
    created_at: string;
    last_seen_at: string | null;
  }[];
  /** Every user linked to exactly this company by membership (any status). */
  members?: CompanyMember[];
  notes: Note[];
  history: ChangeEntry[];
  timeline: { at: string; event: string }[];
  /** Company details awaiting the admin's decision (staged; applied to the record on approval). */
  pendingSubmission: {
    id: string;
    kind: "new_company" | "claim" | "update";
    kindLabel: string;
    status: "pending" | "changes_requested";
    submittedAt: string;
    submittedBy: { name: string; email: string } | null;
    feedback: string | null;
    fields: { key: string; label: string; submitted: string; current: string }[];
  } | null;
  /** Onboarding source, import batch and the company's onboarding history (migration 020). */
  onboarding?: CompanyOnboarding;
  /** Update requests from users who do not manage this company (reviewed one by one). */
  updateRequests: CompanyUpdateRequest[];
  admins: AdminUserRef[];
  requiredFields: { key: string; label: string; section: string; done: boolean }[];
  sectionsOrder: string[];
  editable: {
    profile: Record<string, string>;
    account: Record<string, string>;
    machinery: Record<string, string>;
    required: string[];
  };
};

/** Company onboarding source (backend-assigned). admin_entry / ai_voice_call / ground_sales are
 * reserved and not produced by the backend yet. */
export type OnboardingSource = "database_import" | "web_dashboard" | "admin_entry" | "ai_voice_call" | "ground_sales";

export type StagedSource = { source: string; status: "draft" | "pending" | "changes_requested" | "approved" | "rejected" };

export type RegistrationChannel = "web_signup" | "legacy_account" | "admin_portal";

export type LinkedCompany = {
  id: string;
  name: string | null;
  onboardingSource: OnboardingSource | null;
  sourceNote?: string | null;
  stagedSource?: StagedSource | null;
  reviewStatus: ReviewStatus;
  membershipRole: string;
  isArchived: boolean;
};

export type CompanyOnboarding = {
  source: OnboardingSource | null;
  sourceLabel: string;
  /** Why it is unknown, when the evidence backfill could not resolve it. */
  note?: string | null;
  /** New company not approved yet: source recorded on the staged submission. */
  staged?: StagedSource | null;
  /** Set when the value was assigned by the evidence backfill rather than at creation. */
  backfill?: { outcome: string; rule: string; at: string; evidence: string[]; reason: string | null } | null;
  importBatch: { id: string; reference: string; importedBy: string; importedAt: string } | null;
  history: {
    id: string;
    event: string;
    label: string;
    source: string | null;
    sourceLabel: string;
    actor: string | null;
    actorRole: "requester" | "admin" | "system";
    at: string;
    submissionKind: string | null;
    decision: string | null;
  }[];
};

export type VisionaryRow = {
  id: string;
  name: string | null;
  accountName: string | null;
  email: string;
  phone: string | null;
  accountStatus: AccountStatus;
  registeredAt: string;
  lastActivity: string | null;
  profileSaved: boolean;
  roleTitle: string | null;
  organizationName: string | null;
  location: string | null;
  projectCount: number;
  requestCount: number;
  lastSavedAt: string | null;
};

export type VisionaryList = { total: number; page: number; pageSize: number; rows: VisionaryRow[] };

export type VisionaryDetailData = {
  visionary: VisionaryRow;
  profile: {
    fullName: string;
    roleTitle: string;
    organizationName: string | null;
    location: string;
    introduction: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  } | null;
  projects: {
    id: string;
    name: string;
    idea: string | null;
    status: string;
    product: string | null;
    industry: string | null;
    stage: string | null;
    location: string | null;
    quantity: number | null;
    quantityUnit: string | null;
    budget: number | null;
    currency: string | null;
    timeline: string | null;
    additionalRequirements: string | null;
    requestCount: number;
    createdAt: string;
    updatedAt: string;
  }[];
  requests: {
    id: string;
    number: string;
    status: string;
    manufacturerId: string;
    manufacturerName: string | null;
    projectId: string;
    projectName: string;
    machine: string;
    quantity: number | null;
    unit: string | null;
    duration: string;
    location: string;
    budget: number;
    currency: string;
    timeline: string;
    additionalRequirements: string | null;
    createdAt: string;
    respondedAt: string | null;
  }[];
  draftCount: number;
};

export type ReviewQueue = { rows: ManufacturerRow[]; admins: AdminUserRef[] };

export type UserRow = {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  userType: string;
  roles: string[];
  isAdmin: boolean;
  manufacturerId: string | null;
  companyName: string | null;
  completeness: number | null;
  recordType: RecordType | null;
  /** How the person registered (channel) and the sign-up method / legacy evidence. */
  registrationChannel?: RegistrationChannel | null;
  registrationMethod?: string | null;
  /** Every linked manufacturer company with its own onboarding source; empty = not applicable. */
  companies?: LinkedCompany[];
  registeredAt: string;
  lastActivity: string | null;
  accountStatus: AccountStatus;
  onboardingStatus: ReviewStatus | "NO_PROFILE";
  /** Admin created with an email + password only (no X!Y sign-up). */
  staffOnly: boolean;
  /** Status of the admin email + password sign-in, if the user has one. */
  adminLogin: "active" | "disabled" | null;
};

export type UserList = { total: number; page: number; pageSize: number; rows: UserRow[] };

export type ActivityEvent = {
  kind: "error" | "account_status" | "admin_login" | "admin_login_failed";
  method: string | null;
  path: string | null;
  status_code: number | null;
  detail: string | null;
  request_id: string | null;
  created_at: string;
  actor: string | null;
};

export type UserDetail = {
  user: UserRow;
  manufacturers: {
    organization_id: string;
    company_name: string | null;
    review_status: ReviewStatus;
    completeness: number;
    record_type: RecordType;
    is_archived: boolean;
    membership_role: string;
    membership_status?: string;
    entry_source?: EntrySource;
    onboarding_source?: OnboardingSource | null;
    onboarding_source_label?: string;
    staged_source?: StagedSource | null;
    machinery_count?: number;
  }[];
  troubleshooting: {
    accountStatus: AccountStatus;
    lastLogin: { lastSignInAt: string | null; available: boolean };
    lastActivity: string | null;
    lastSuccessfulSave: string | null;
    profileWizardStep: string | null;
    onboarding: { lastCompleted: string | null; stoppedAt: string | null; missingFields: string[] } | null;
    events: ActivityEvent[];
    notificationStatus: string;
    emails?: EmailDelivery[];
  };
  clerkSynced?: boolean;
};

export type EmailDelivery = {
  id: string;
  to_email: string;
  template: string;
  subject: string;
  status: "sent" | "failed" | "skipped";
  error: string | null;
  created_at: string;
};

export type EmailLog = { emails: EmailDelivery[]; smtpConfigured: boolean };

export type TestEmailResult = {
  status: EmailDelivery["status"];
  error: string | null;
  to: string;
  smtpConfigured: boolean;
};

export type RecentError = {
  method: string | null;
  path: string | null;
  status_code: number | null;
  detail: string | null;
  request_id: string | null;
  created_at: string;
  user_id: string | null;
  email: string | null;
  name: string | null;
};

export type CountRow = { label: string; count: number };

export type Analytics = {
  range: { from: string | null; to: string | null; includeTest: boolean };
  registrations: { users: number; manufacturers: number; usersWithoutProfile: number };
  onboarding: { completed: number; incomplete: number; completionRate: number };
  dropOff: CountRow[];
  byIndustry: CountRow[];
  byLocation: CountRow[];
  byProcess: CountRow[];
  byReferral: CountRow[];
  byReviewStatus: CountRow[];
  entrySources: (CountRow & { completed: number })[];
  missingFields: { label: string; section: string; count: number }[];
  excludedDemoTest: number;
};

/** A proposed change to an existing company by someone who does not manage it. */
export type CompanyUpdateRequest = {
  id: string;
  status: "pending" | "changes_requested" | "approved" | "rejected";
  source: string;
  requestType: "existing_company_update";
  requester: { id: string; name: string; email: string };
  submittedAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  appliedAt: string | null;
  feedback: string | null;
  adminNotes: string;
  appliedChanges: Record<string, { from: string; to: string }> | null;
  fields: {
    key: string;
    label: string;
    /** the company record now */
    current: string;
    /** proposed value (after any admin edits) */
    proposed: string;
    /** as the requester submitted it */
    submitted: string;
    /** the company's value when the request was submitted */
    atSubmission: string;
    companyChanged: boolean;
    differs: boolean;
    edited: boolean;
  }[];
  /** what the admin is looking at; required to decide (null once decided) */
  fingerprint: string | null;
  events: { event: string; by: string | null; role: "requester" | "admin"; at: string; details: Record<string, unknown> }[];
};

/** GET /admin/manufacturers/{id}/people: memberships and requests of exactly this company. */
export type CompanyPeople = {
  registeredUsers: {
    id: string;
    name: string | null;
    email: string;
    role: string;
    membershipStatus: string;
    accountStatus: AccountStatus;
    linkedAt: string | null;
    registeredAt: string | null;
    roles: string[];
  }[];
  requests: {
    id: string;
    kind: string;
    kindLabel: string;
    status: "pending" | "changes_requested" | "approved" | "rejected" | "draft";
    statusLabel: string;
    source: string;
    submittedAt: string;
    reviewedAt: string | null;
    reviewer: string | null;
    feedback: string | null;
    requester: { id: string; name: string | null; email: string } | null;
    requesterIsMember: boolean;
  }[];
  counts: { linkedUsers: number; openRequests: number };
};

export type CompanyMember = {
  id: string;
  name: string | null;
  email: string;
  accountStatus: AccountStatus;
  membershipRole: string;
  membershipStatus: "active" | "suspended" | "removed";
  roles: string[];
  linkedAt: string;
  lastSeenAt: string | null;
};

/** GET /admin/machinery (Machinery tab): company assets, not users. */
export type MachineRow = {
  id: string;
  name: string;
  industry: string | null;
  capacity: string | null;
  maker: string | null;
  model: string | null;
  year: number | null;
  listingStatus: "Published" | "Draft" | "Unpublished" | "Archived";
  companyId: string;
  companyName: string | null;
  recordType: RecordType;
  imageCount: number;
  availability: string | null;
  createdAt: string;
};
export type MachineList = { total: number; page: number; pageSize: number; rows: MachineRow[]; company: string | null };
