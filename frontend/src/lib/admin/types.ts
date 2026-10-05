/** Shapes returned by the Admin API (/api/v1/admin/...). */

export type ReviewStatus = "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "NEEDS_CORRECTION" | "REVIEWED";
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
  notes: Note[];
  history: ChangeEntry[];
  timeline: { at: string; event: string }[];
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
